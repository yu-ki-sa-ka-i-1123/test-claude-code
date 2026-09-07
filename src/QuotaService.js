// 月間送信通数のガード判定。
// 「送信通数 = グループのメンバー数」を月次で積み上げ、上限を超える見込みなら送信を止める。

function willExceedMonthlyLimit(monthlySentSoFar, memberCount, monthlyLimit) {
  return monthlySentSoFar + memberCount > monthlyLimit;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { willExceedMonthlyLimit: willExceedMonthlyLimit };
}
