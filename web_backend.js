/* GitHub Pages 版の所持リスト共有（Firebase Firestore）。ships.html の MODE='web' から initWeb() が呼ばれる。
 * Firebase は収支帳と同じプロジェクト（auec-ledger）。リストは URL の #以降（推測できない長いID）で区別し、
 * それを知っている人だけが読み書きできる（firestore.rules の fleets）。#がなければ、これまでどおりこのブラウザに保存する。
 * 文言は ships.html の L(日本語, 英語) で出し分け、言語が切り替わると webLangChanged() で出し直す。 */

const NAME_KEY = 'scships-name';
let panelView = null;   // 今の案内欄を描く関数（言語の切り替えで描き直すため）

function newFleetId(){
  const a = new Uint8Array(18); crypto.getRandomValues(a);
  return Array.from(a, b => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('') + 'x' + Date.now().toString(36);
}

function webPanel(view){
  panelView = view;
  const p = $('webPanel');
  if(!view){ p.innerHTML = ''; p.hidden = true; return p; }
  p.innerHTML = view(); p.hidden = false;
  if(view.bind) view.bind(p);
  return p;
}
function webLangChanged(){ if(panelView && !$('webPanel').hidden) webPanel(panelView); }

function askName(){
  return new Promise(done => {
    const view = () => `<h2>${L('あなたの名前', 'Your name')}</h2>
      <p class="hint">${L('共有リストで「誰の船か」の表示に使います。ゲーム内の名前やニックネームで大丈夫です。', 'Shown on the shared list as the owner of each ship. Your in-game handle or a nickname is fine.')}</p>
      <form id="nameForm" class="frow" style="margin-top:10px">
        <label class="f"><span class="lab">${L('名前', 'Name')}</span><input type="text" id="myName" maxlength="20" required value="${esc(store.me)}"></label>
        <button class="btn" type="submit">${L('決定', 'Save')}</button></form>`;
    view.bind = p => {
      p.querySelector('#nameForm').onsubmit = ev => {
        ev.preventDefault();
        const v = p.querySelector('#myName').value.trim();
        if(!v) return;
        lsSet(NAME_KEY, v); store.me = v; webPanel(null); done();
      };
    };
    webPanel(view);
  });
}

async function initWeb(){
  const cfg = window.FIREBASE_CONFIG || {};
  const fid = location.hash.replace(/^#/, '');

  // 共有リストなし: このブラウザに保存し、共有を始めるボタンだけ出す
  if(!/^[a-z0-9]{20,64}$/.test(fid)){
    if(lsGet('scships-hide-share')) return;
    const view = () => `<h2>${L('所持リストを共有する', 'Share your owned list')}</h2>
      <p class="hint">${L('今は所持・欲しい船の印がこのブラウザだけに保存されます。共有リストを作ると専用のURLが発行され、そのURLを開いた人どうしで印とメモを共有できます（このブラウザの印はそのまま移ります）。相手からURLをもらっている場合は、そのURLを開いてください。',
        'Owned and wanted marks are currently saved in this browser only. Create a shared list to get a private URL; everyone who opens it shares the same marks and notes (your marks here move over). If someone sent you a URL, open that instead.')}</p>
      <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="button" id="mkFleet">${L('共有リストを作る', 'Create a shared list')}</button>
      <button class="btn ghost" type="button" id="hideFleet">${L('今は使わない', 'Not now')}</button></div>`;
    view.bind = p => {
      p.querySelector('#mkFleet').onclick = () => { location.hash = newFleetId(); location.reload(); };
      p.querySelector('#hideFleet').onclick = () => { lsSet('scships-hide-share', '1'); webPanel(null); };
    };
    webPanel(view);
    return;
  }

  const fail = (ja, en) => {
    setNote(() => `${L('所持リスト', 'Owned list')}: <b style="color:var(--neg)">${L('接続できません', 'not connected')}</b>`);
    webPanel(() => `<h2>${L('共有リストに接続できませんでした', 'Could not connect to the shared list')}</h2><p class="hint">${esc(L(ja, en))}</p>
      <p class="hint">${L('船の一覧と比較はこのまま使えます。所持の印は保存されません。広告ブロックなどの拡張機能を止めて、読み込み直してください。', 'The list and comparison still work, but marks will not be saved. Turn off ad blockers or similar extensions and reload.')}</p>`);
  };
  // 接続するまでは保存させない（このブラウザにだけ残るのを防ぐ）
  const notReady = () => Promise.reject({code: L('共有リストに接続中です', 'still connecting to the shared list')});
  store.add = store.remove = store.setMemo = notReady;

  if(!cfg.apiKey){ fail('config.js に Firebase の設定がありません。', 'config.js has no Firebase settings.'); return; }
  if(typeof firebase === 'undefined'){ fail('接続用のプログラム（Firebase）を読み込めませんでした。', 'Could not load the Firebase library.'); return; }
  if(!lsGet(NAME_KEY)){ setNote(() => `${L('所持リスト', 'Owned list')}: <b>${L('名前の入力待ち', 'waiting for your name')}</b>`); await askName(); }
  store.me = lsGet(NAME_KEY);

  setNote(() => `${L('所持リスト', 'Owned list')}: <b>${L('共有リストに接続中…', 'connecting…')}</b>`);
  let col;
  try{
    // 収支帳と同じプロジェクトでも、別の名前のアプリとして初期化して設定がぶつからないようにする
    const app = firebase.initializeApp(cfg, 'sc-ships');
    await app.auth().signInAnonymously();
    col = app.firestore().collection('fleets').doc(fid).collection('items');
  }catch(e){ const c = e.code || e.message; fail('ログイン（匿名）に失敗しました: ' + c, 'Anonymous sign-in failed: ' + c); return; }

  const local = store.items.slice();   // 共有前にこのブラウザで付けた印
  let first = true;
  col.onSnapshot(snap => {
    store.items = snap.docs.map(d => Object.assign({id: d.id}, d.data()));
    store.shared = true;
    setNote(() => `${L('所持リスト', 'Owned list')}: <b>${L('共有リスト', 'shared')}</b> (${esc(store.me)})　<a href="#" onclick="askName().then(() => setNote(storeNoteHTML));return false">${L('名前を変える', 'Change name')}</a>`);
    if(first){
      first = false;
      // このブラウザの印を共有リストへ移して、手元からは消す
      if(local.length){
        Promise.all(local.map(i => col.add({ship: i.ship, kind: i.kind, by: store.me, memo: i.memo || '', createdAt: firebase.firestore.FieldValue.serverTimestamp()})))
          .then(() => { lsSet(LOCAL_KEY, '[]'); flash(L(`このブラウザの印 ${local.length} 件を共有リストへ移しました`, `Moved ${local.length} marks from this browser to the shared list`)); })
          .catch(e => flash(L('印を共有リストへ移せませんでした: ', 'Could not move your marks: ') + (e.code || e.message)));
      }
    }
    render(); refreshDetail();
  }, e => { const c = e.code || e.message; fail(`共有リストを読めませんでした: ${c}（Firebase のルールに fleets が入っているか確認してください）`, `Could not read the shared list: ${c} (check that the Firebase rules include fleets)`); });

  store.add = (ship, kind) => col.add({ship, kind, by: store.me, memo: '', createdAt: firebase.firestore.FieldValue.serverTimestamp()});
  store.remove = id => col.doc(id).delete();
  store.setMemo = (id, memo) => col.doc(id).update({memo: memo.slice(0, 200)});
}
