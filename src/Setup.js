// スプレッドシートのカスタムメニュー。非エンジニアのスタッフがこのメニューだけで
// 初期セットアップ・トークン設定・トリガー設定・動作テストまで行えるようにする。

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('リマインドBot管理')
    .addItem('① 初期セットアップ(シート作成)', 'menuInitialSetup_')
    .addItem('② LINEチャネルアクセストークンを設定', 'menuSetChannelAccessToken_')
    .addItem('③ Webhook URLを表示', 'menuShowWebhookUrl_')
    .addItem('④ 1時間ごとの定期実行を設定', 'menuInstallHourlyTrigger_')
    .addSeparator()
    .addItem('今すぐ判定を実行(テスト用)', 'menuRunReminderCheckNow_')
    .addToUi();
}

function menuInitialSetup_() {
  var ui = SpreadsheetApp.getUi();
  var message = setupSheets();
  ensureWebhookToken_();
  ui.alert(message + '\n\nWebhookの共有トークンも発行しました。「③ Webhook URLを表示」から確認してください。');
}

function ensureWebhookToken_() {
  var props = PropertiesService.getScriptProperties();
  var existing = props.getProperty(SCRIPT_PROPERTY_KEYS.WEBHOOK_SHARED_TOKEN);
  if (!existing) {
    var token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty(SCRIPT_PROPERTY_KEYS.WEBHOOK_SHARED_TOKEN, token);
  }
}

function menuSetChannelAccessToken_() {
  var ui = SpreadsheetApp.getUi();
  var response = ui.prompt(
    'LINE Channel Access Token を入力してください',
    'LINE Developers Console の「Messaging API設定」タブで発行したロングライブトークンを貼り付けてください。',
    ui.ButtonSet.OK_CANCEL
  );
  if (response.getSelectedButton() !== ui.Button.OK) return;
  var token = response.getResponseText().trim();
  if (!token) {
    ui.alert('入力が空でした。もう一度お試しください。');
    return;
  }
  PropertiesService.getScriptProperties().setProperty(SCRIPT_PROPERTY_KEYS.LINE_CHANNEL_ACCESS_TOKEN, token);
  ui.alert('保存しました(スクリプトプロパティに格納されます。シートには表示されません)。');
}

function menuShowWebhookUrl_() {
  var ui = SpreadsheetApp.getUi();
  ensureWebhookToken_();
  var token = getScriptProperty(SCRIPT_PROPERTY_KEYS.WEBHOOK_SHARED_TOKEN);
  var url;
  try {
    url = ScriptApp.getService().getUrl();
  } catch (err) {
    url = null;
  }
  if (!url) {
    ui.alert(
      'まだWebアプリとしてデプロイされていないため、URLを取得できませんでした。\n' +
        '先に「デプロイ」→「新しいデプロイ」から種類「ウェブアプリ」として公開してから、再度実行してください。'
    );
    return;
  }
  ui.alert(
    'LINE Developers Console の Webhook URL 欄に、以下をそのまま貼り付けてください:\n\n' +
      url +
      '?token=' +
      token +
      '\n\n※このURLはトークンを含む秘密情報です。第三者に共有しないでください。'
  );
}

function menuInstallHourlyTrigger_() {
  var ui = SpreadsheetApp.getUi();
  installHourlyTrigger();
  ui.alert('1時間ごとの定期実行トリガーを設定しました(既に設定済みの場合は何もしていません)。');
}

function installHourlyTrigger() {
  var already = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'runReminderCheck';
  });
  if (already) return;
  ScriptApp.newTrigger('runReminderCheck').timeBased().everyHours(1).create();
}

function menuRunReminderCheckNow_() {
  var ui = SpreadsheetApp.getUi();
  try {
    runReminderCheck();
    ui.alert('判定処理を実行しました。「送信ログ」シートを確認してください。');
  } catch (err) {
    ui.alert('エラーが発生しました: ' + err);
  }
}
