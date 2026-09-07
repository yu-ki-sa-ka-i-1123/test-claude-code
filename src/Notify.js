// 管理者向け警告通知(GmailApp経由のメール送信)。

function notifyAdminQuotaExceeded(adminEmail, monthlySentSoFar, monthlyLimit, exampleClientName) {
  if (!adminEmail) return;
  var subject = '[LINEリマインドBot] 月間送信上限のため送信を停止しました';
  var body = [
    '当月の送信通数が上限に達する見込みのため、一部のリマインド送信を停止しました。',
    '',
    '現在の月間累計通数: ' + monthlySentSoFar,
    '月間送信上限: ' + monthlyLimit,
    '送信を見送った例: ' + (exampleClientName || '(複数の可能性があります)'),
    '',
    '「共通設定」シートの月間送信上限、または各クライアントの送信間隔を見直してください。',
    '(このメールは自動送信です)'
  ].join('\n');
  sendAdminEmail_(adminEmail, subject, body);
}

function notifyAdminSendFailure(adminEmail, clientName, groupId, error) {
  if (!adminEmail) return;
  var subject = '[LINEリマインドBot] 送信に失敗しました: ' + (clientName || groupId);
  var body = [
    'リマインドメッセージの送信に失敗しました。',
    '',
    'クライアント: ' + (clientName || '(不明)'),
    'group_id: ' + groupId,
    'エラー内容: ' + String(error),
    '',
    '詳細は「送信ログ」シートを確認してください。',
    '(このメールは自動送信です)'
  ].join('\n');
  sendAdminEmail_(adminEmail, subject, body);
}

function sendAdminEmail_(adminEmail, subject, body) {
  try {
    GmailApp.sendEmail(adminEmail, subject, body);
  } catch (err) {
    // 通知メール自体の送信失敗はログにのみ残す(通知失敗の再通知はループの原因になるため行わない)。
    try {
      appendLog({
        datetime: new Date(),
        client: '',
        groupId: '',
        templateKey: '',
        count: 0,
        result: '失敗',
        error: '管理者通知メールの送信に失敗しました: ' + err
      });
    } catch (logErr) {
      // no-op
    }
  }
}
