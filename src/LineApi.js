// LINE Messaging API 呼び出し(プッシュメッセージ送信 / グループメンバー数取得)。
// API失敗時は指数バックオフでリトライする。

function fetchWithRetry_(url, options, maxRetries) {
  maxRetries = maxRetries || 3;
  var lastError = null;
  for (var attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      var response = UrlFetchApp.fetch(url, options);
      var code = response.getResponseCode();
      if (code >= 500 || code === 429) {
        // サーバ側エラー・レート制限はリトライ対象。
        lastError = new Error('HTTP ' + code + ': ' + response.getContentText());
        if (attempt < maxRetries) {
          Utilities.sleep(getBackoffMs_(attempt));
          continue;
        }
        return response;
      }
      return response; // 2xx、および429以外の4xxはここでそのまま返す(呼び出し元で判定)
    } catch (err) {
      lastError = err;
      if (attempt < maxRetries) {
        Utilities.sleep(getBackoffMs_(attempt));
      }
    }
  }
  throw lastError || new Error('fetchWithRetry_: 不明なエラー');
}

function getBackoffMs_(attempt) {
  return Math.pow(2, attempt) * 500; // 1s, 2s, 4s...
}

function pushLineMessage(to, text) {
  var token = getScriptProperty(SCRIPT_PROPERTY_KEYS.LINE_CHANNEL_ACCESS_TOKEN);
  if (!token) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です。メニューから設定してください。');
  }
  var url = 'https://api.line.me/v2/bot/message/push';
  var payload = {
    to: to,
    messages: [{ type: 'text', text: text }]
  };
  var response = fetchWithRetry_(url, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + token },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(
      'プッシュ送信失敗: status=' + response.getResponseCode() + ' body=' + response.getContentText()
    );
  }
  return response;
}

function fetchGroupMemberCount_(groupId) {
  var token = getScriptProperty(SCRIPT_PROPERTY_KEYS.LINE_CHANNEL_ACCESS_TOKEN);
  if (!token) {
    throw new Error('LINE_CHANNEL_ACCESS_TOKEN が未設定です。メニューから設定してください。');
  }
  var url = 'https://api.line.me/v2/bot/group/' + encodeURIComponent(groupId) + '/members/count';
  var response = fetchWithRetry_(url, {
    method: 'get',
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) {
    throw new Error(
      'メンバー数取得失敗: group=' +
        groupId +
        ' status=' +
        response.getResponseCode() +
        ' body=' +
        response.getContentText()
    );
  }
  var json = JSON.parse(response.getContentText());
  return json.count;
}

var MEMBER_COUNT_CACHE_SECONDS = 6 * 60 * 60; // 6時間

// メンバー数は変動が少ないため、通数計算のたびにAPIを呼ばずキャッシュを利用する。
function getGroupMemberCountCached(groupId) {
  var cache = CacheService.getScriptCache();
  var key = 'member_count_' + groupId;
  var cached = cache.get(key);
  if (cached !== null) {
    return Number(cached);
  }
  var count = fetchGroupMemberCount_(groupId);
  cache.put(key, String(count), MEMBER_COUNT_CACHE_SECONDS);
  return count;
}
