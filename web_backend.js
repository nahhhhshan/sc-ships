/* GitHub Pages 版の所持リスト共有（Firebase Firestore）。ships.html の MODE='web' から initWeb() が呼ばれる。
 * Firebase は収支帳と同じプロジェクト（auec-ledger）。リストは URL の #以降（推測できない長いID）で区別し、
 * それを知っている人だけが読み書きできる（firestore.rules の fleets）。#がなければ、これまでどおりこのブラウザに保存する。 */

const NAME_KEY = 'scships-name';

function newFleetId(){
  const a = new Uint8Array(18); crypto.getRandomValues(a);
  return Array.from(a, b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('') + 'x' + Date.now().toString(36);
}

function webPanel(html){
  const p = $('webPanel');
  p.innerHTML = html; p.hidden = !html;
  return p;
}

function askName(){
  return new Promise(done => {
    const p = webPanel(`<h2>あなたの名前</h2>
      <p class="hint">共有リストで「誰の船か」の表示に使います。ゲーム内の名前やニックネームで大丈夫です。</p>
      <form id="nameForm" class="frow" style="margin-top:10px">
        <label class="f"><span class="lab">名前</span><input type="text" id="myName" maxlength="20" required value="${esc(store.me)}"></label>
        <button class="btn" type="submit">決定</button></form>`);
    p.querySelector('#nameForm').onsubmit = ev => {
      ev.preventDefault();
      const v = p.querySelector('#myName').value.trim();
      if(!v) return;
      lsSet(NAME_KEY, v); store.me = v; webPanel(''); done();
    };
  });
}

async function initWeb(){
  const cfg = window.FIREBASE_CONFIG || {};
  const fid = location.hash.replace(/^#/, '');

  // 共有リストなし: このブラウザに保存し、共有を始めるボタンだけ出す
  if(!/^[a-z0-9]{20,64}$/.test(fid)){
    const p = webPanel(`<h2>所持リストを共有する</h2>
      <p class="hint">今は所持・欲しい船の印がこのブラウザだけに保存されます。共有リストを作ると専用のURLが発行され、そのURLを開いた人どうしで印とメモを共有できます（このブラウザの印はそのまま移ります）。相手からURLをもらっている場合は、そのURLを開いてください。</p>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" id="mkFleet">共有リストを作る</button>
      <button class="btn ghost" type="button" id="hideFleet">今は使わない</button></div>`);
    if(lsGet('scships-hide-share')) p.hidden = true;
    p.querySelector('#mkFleet').onclick = () => { location.hash = newFleetId(); location.reload(); };
    p.querySelector('#hideFleet').onclick = () => { lsSet('scships-hide-share', '1'); p.hidden = true; };
    return;
  }

  const note = html => { $('storeNote').innerHTML = html; };
  const fail = msg => {
    note('所持リスト: <b style="color:var(--neg)">接続できません</b>');
    webPanel('<h2>共有リストに接続できませんでした</h2><p class="hint">' + msg + '</p><p class="hint">船の一覧と比較はこのまま使えます。所持の印は保存されません。広告ブロックなどの拡張機能を止めて、読み込み直してください。</p>');
  };
  // 接続するまでは保存させない（このブラウザにだけ残るのを防ぐ）
  const notReady = () => Promise.reject({code: '共有リストに接続中です'});
  store.add = store.remove = store.setMemo = notReady;

  if(!cfg.apiKey){ fail('config.js に Firebase の設定がありません。'); return; }
  if(typeof firebase === 'undefined'){ fail('接続用のプログラム（Firebase）を読み込めませんでした。'); return; }
  if(!lsGet(NAME_KEY)){ note('所持リスト: <b>名前の入力待ち</b>'); await askName(); }
  store.me = lsGet(NAME_KEY);

  note('所持リスト: <b>共有リストに接続中…</b>');
  let col;
  try{
    // 収支帳と同じプロジェクトでも、別の名前のアプリとして初期化して設定がぶつからないようにする
    const app = firebase.initializeApp(cfg, 'sc-ships');
    await app.auth().signInAnonymously();
    col = app.firestore().collection('fleets').doc(fid).collection('items');
  }catch(e){ fail('ログイン（匿名）に失敗しました: ' + (e.code || e.message)); return; }

  const local = store.items.slice();   // 共有前にこのブラウザで付けた印
  let first = true;
  col.onSnapshot(snap => {
    store.items = snap.docs.map(d => Object.assign({id: d.id}, d.data()));
    store.shared = true;
    note(`所持リスト: <b>共有リスト</b>（${esc(store.me)}）　<a href="#" id="renameBtn">名前を変える</a>`);
    $('renameBtn').onclick = e => { e.preventDefault(); askName().then(() => note(`所持リスト: <b>共有リスト</b>（${esc(store.me)}）`)); };
    if(first){
      first = false;
      // このブラウザの印を共有リストへ移して、手元からは消す
      if(local.length){
        Promise.all(local.map(i => col.add({ship: i.ship, kind: i.kind, by: store.me, memo: i.memo || '', createdAt: firebase.firestore.FieldValue.serverTimestamp()})))
          .then(() => { lsSet(LOCAL_KEY, '[]'); flash(`このブラウザの印 ${local.length} 件を共有リストへ移しました`); })
          .catch(e => flash('印を共有リストへ移せませんでした: ' + (e.code || e.message)));
      }
    }
    render(); refreshDetail();
  }, e => fail('共有リストを読めませんでした: ' + (e.code || e.message) + '（Firebase のルールに fleets が入っているか確認してください）'));

  store.add = (ship, kind) => col.add({ship, kind, by: store.me, memo: '', createdAt: firebase.firestore.FieldValue.serverTimestamp()});
  store.remove = id => col.doc(id).delete();
  store.setMemo = (id, memo) => col.doc(id).update({memo: memo.slice(0, 200)});
}
