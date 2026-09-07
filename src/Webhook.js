// LINE Messaging API の Webhook 受信エンドポイント。
//
// 【重要な既知の制約】
// Google Apps Script の doPost(e) は HTTPリクエストヘッダーを一切取得できない
// (Googleが2023年に公式に「セキュリティ上の理由でサポートしない」と表明している仕様)。
// そのため本来必須である X-Line-Signature ヘッダーのHMAC-SHA256署名検証を
// GAS単体では実装できない。
//
// 代替として、Webhook URLに推測困難な共有トークンをクエリパラメータとして付与し
// (?token=xxxx)、doPost側でスクリプトプロパティに保存した値と一致するかを
// チェックする簡易認証を採用している(スコープ外のPhase 0確認事項でユーザー承認済み)。
// 運用上はWebhook URL(トークン込み)を秘匿情報として扱うこと。

function doGet(e) {
  return ContentService.createTextOutput('LINE Client Reminder System is running.');
}

function doPost(e) {
  try {
    if (!isAuthorizedWebhookRequest_(e)) {
      // 認証NG。詳細を返さず200で握りつぶす(スキャン等への情報漏洩・再試行の誘発を避ける)。
      return ContentService.createTextOutput('');
    }

    var body = JSON.parse(e.postData.contents);
    var events = body.events || [];
    events.forEach(function (event) {
      try {
        handleLineEvent_(event);
      } catch (err) {
        appendLog({
          datetime: new Date(),
          client: '',
          groupId: (event.source && (event.source.groupId || event.source.roomId)) || '',
          templateKey: '',
          count: 0,
          result: '失敗',
          error: 'Webhookイベント処理エラー: ' + err
        });
      }
    });
  } catch (err) {
    // JSONパース失敗など。LINE側の再送を避けるため200を返す。
  }
  return ContentService.createTextOutput('');
}

function isAuthorizedWebhookRequest_(e) {
  var expectedToken = getScriptProperty(SCRIPT_PROPERTY_KEYS.WEBHOOK_SHARED_TOKEN);
  var actualToken = e && e.parameter && e.parameter.token;
  return !!expectedToken && actualToken === expectedToken;
}

function handleLineEvent_(event) {
  var sourceType = event.source && event.source.type;
  // グループ・複数人トークのみ対象(個人トークは今回のシステムの対象外)。
  if (sourceType !== 'group' && sourceType !== 'room') {
    return;
  }
  var groupId = event.source.groupId || event.source.roomId;
  if (!groupId) return;

  if (event.type === 'join') {
    withScriptLock(function () {
      appendClientRowForJoin(groupId);
    });
    return;
  }

  if (event.type === 'leave') {
    withScriptLock(function () {
      var client = findClientRowByGroupId(groupId);
      if (!client) return;
      // ボットがグループから退出した場合、誤って送信し続けないよう自動的に無効化する。
      var sheet = getSheet(SHEET_NAMES.CLIENTS);
      var headerMap = getHeaderMap(sheet);
      sheet.getRange(client.rowIndex, headerMap['enabled']).setValue(false);
    });
    return;
  }

  if (event.type === 'message') {
    // テキストに限らずスタンプ・画像・ファイル等、すべて「発言」として扱う。
    // ボット自身の送信メッセージはWebhookイベントとして届かないため、除外処理は不要。
    withScriptLock(function () {
      var client = findClientRowByGroupId(groupId);
      if (!client) return; // 未登録グループ(通常はjoinイベントで自動登録される)
      var nextState = applyHumanMessageUpdate(
        {
          lastHumanMessageAt: client.lastHumanMessageAt,
          lastReminderSentAt: client.lastReminderSentAt,
          reminderStage: client.reminderStage,
          consecutiveReminders: client.consecutiveReminders
        },
        new Date()
      );
      updateClientState(client.rowIndex, nextState);
    });
    return;
  }
}
