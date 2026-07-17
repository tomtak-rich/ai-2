/**
 * 철거의 정석 — 상담 신청(구글폼) → 디자인된 HTML 메일 자동 발송
 *
 * [설치 방법]
 * 1) 구글폼 편집 화면 → 우상단 ⋮ → '스크립트 편집기' (또는 응답 연결 스프레드시트 → 확장 프로그램 → Apps Script)
 * 2) 아래 코드 전체를 붙여넣고 저장
 * 3) 왼쪽 '트리거(시계 아이콘)' → '트리거 추가'
 *      - 실행할 함수: onFormSubmit
 *      - 이벤트 소스: 설문지에서 (양식 제출 시)   ※ 스프레드시트면 '스프레드시트에서 - 양식 제출 시'
 * 4) 권한 승인(본인 계정) → 완료. 이후 신청마다 메일이 자동 발송됩니다.
 *
 * [형식 수정] 메일 디자인/문구는 buildHtml() 함수만 고치면 됩니다.
 */

var NOTIFY_TO   = 'dnslwkatn1@gmail.com';   // 받는 메일
var BRAND       = '철거의 정석';
var SITE_LABEL  = 'AI 견적 상세페이지';
var BRAND_COLOR = '#2F6BF6';
var FORM_RESPONSES_URL = 'https://docs.google.com/forms/d/1R9ktuWKnXr0gydCTw2t0FoWHTxvinEEIMerusPqqdvY/edit#responses';

// 폼 질문 제목 (폼에서 질문 문구를 바꾸면 여기도 동일하게 맞춰주세요)
var Q = {
  building:  '철거할 공간 유형',
  area:      '평수 입력 (평)',
  mode:      '철거 방식 선택',
  scope:     '철거 범위 선택 (중복 가능)',
  restore:   '원상복구가 필요하신가요?',
  waste:     '폐기물 처리가 필요하신가요?',
  transport: '반출 환경',
  name:      '이름 / 업체명',
  contact:   '연락처',
  address:   '현장 주소',
  detail:    '상세 주소',
  total:     'AI 견적서에 표시된 예상 견적 금액 (선택)',
  when:      '희망 공사 시기 (선택)',
  note:      '기타 문의사항 (선택)'
};

function onFormSubmit(e) {
  // 트리거 종류에 따라 이벤트 구조가 다르므로 둘 다 지원:
  //  - 폼에 직접 붙인 트리거: e.response (FormResponse)
  //  - 스프레드시트에 붙인 트리거: e.namedValues (제목→값)
  var map = {};
  if (e && e.response && typeof e.response.getItemResponses === 'function') {
    var items = e.response.getItemResponses();
    for (var i = 0; i < items.length; i++) {
      var resp = items[i].getResponse();
      if (Array.isArray(resp)) resp = resp.filter(String).join(', ');
      map[items[i].getItem().getTitle()] = resp;
    }
  } else if (e && e.namedValues) {
    for (var k in e.namedValues) {
      var v = e.namedValues[k];
      map[k] = Array.isArray(v) ? v.filter(String).join(', ') : v;
    }
  }
  var get = function (title) {
    var v = map[title];
    return (v == null ? '' : String(v)).trim();
  };
  var d = {
    building:  get(Q.building),
    area:      get(Q.area),
    mode:      get(Q.mode),
    scope:     get(Q.scope),
    restore:   get(Q.restore),
    waste:     get(Q.waste),
    transport: get(Q.transport),
    name:      get(Q.name)    || '고객',
    contact:   get(Q.contact),
    address:   get(Q.address),
    detail:    get(Q.detail),
    total:     get(Q.total),
    when:      get(Q.when),
    note:      get(Q.note)
  };
  var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var subject = '[' + BRAND + '] 새 상담 신청 · ' + d.name + ' / ' + (d.building || '-') + ' ' + (d.area ? d.area + '평' : '');

  GmailApp.sendEmail(NOTIFY_TO, subject, plainBody(d, now), {
    name: BRAND,
    htmlBody: buildHtml(d, now)
  });
}

function plainBody(d, now) {
  return [
    BRAND + ' 새 상담 신청 (' + now + ')',
    '이름/업체: ' + d.name,
    '연락처: ' + d.contact,
    '현장주소: ' + d.address + ' ' + d.detail,
    '공간유형: ' + d.building,
    '철거방식: ' + d.mode + ' (' + d.area + '평)',
    '철거범위: ' + d.scope,
    '원상복구: ' + d.restore + ' / 폐기물: ' + d.waste + ' / 반출: ' + d.transport,
    '예상견적: ' + d.total,
    '희망시기: ' + d.when,
    '기타/상세: ' + d.note
  ].join('\n');
}

// ▼▼▼ 메일 디자인 — 형식 바꾸려면 이 함수만 수정 ▼▼▼
function buildHtml(d, now) {
  var row = function (label, value) {
    if (!value) return '';
    return '' +
      '<tr><td style="padding:14px 0 4px;font-size:13px;font-weight:700;color:#111827;">' + esc(label) + '</td></tr>' +
      '<tr><td style="padding:0 0 14px;font-size:15px;color:#374151;line-height:1.5;border-bottom:1px solid #f0f2f5;white-space:pre-line;">' + esc(value) + '</td></tr>';
  };
  var meta = function (label, value) {
    return '<tr><td style="padding:3px 0;font-size:13px;color:#8a929c;width:78px;">' + esc(label) + '</td>' +
           '<td style="padding:3px 0;font-size:13px;color:#374151;">' + esc(value) + '</td></tr>';
  };
  var addr = (d.address + (d.detail ? '\n' + d.detail : '')).trim();

  return '' +
  '<div style="margin:0;padding:24px 12px;background:#eceff4;font-family:-apple-system,BlinkMacSystemFont,\'Malgun Gothic\',sans-serif;">' +
    '<table role="presentation" align="center" width="520" style="max-width:520px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;margin:0 auto;box-shadow:0 6px 24px rgba(20,30,60,.08);">' +
      '<tr><td style="padding:36px 40px 8px;text-align:center;">' +
        '<div style="font-size:14px;font-weight:700;color:#8a929c;letter-spacing:-.01em;">' + esc(BRAND) + '</div>' +
        '<div style="font-size:24px;font-weight:800;color:#111827;margin-top:14px;letter-spacing:-.02em;">' +
          '<span style="color:' + BRAND_COLOR + ';">새 상담 신청</span>이 접수되었습니다.' +
        '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:22px 40px 6px;">' +
        '<table role="presentation" width="100%">' +
          meta('등록위치', SITE_LABEL) +
          meta('등록시각', now) +
          (d.when ? meta('희망시기', d.when) : '') +
        '</table>' +
      '</td></tr>' +
      '<tr><td style="padding:18px 40px 4px;">' +
        '<div style="font-size:15px;font-weight:800;color:#111827;border-bottom:2px solid #111827;padding-bottom:8px;">상담 정보</div>' +
      '</td></tr>' +
      '<tr><td style="padding:0 40px 8px;">' +
        '<table role="presentation" width="100%">' +
          row('이름 / 업체명', d.name) +
          row('연락처', d.contact) +
          row('현장 주소', addr) +
          row('공간 유형', d.building) +
          row('철거 방식', d.mode + (d.area ? ' (' + d.area + '평)' : '')) +
          row('철거 범위', d.scope) +
          row('원상복구 / 폐기물 / 반출', d.restore + ' / ' + d.waste + ' / ' + d.transport) +
          row('예상 견적 금액', d.total) +
          row('기타 문의 / 견적 상세', d.note) +
        '</table>' +
      '</td></tr>' +
      '<tr><td style="padding:22px 40px 36px;text-align:center;">' +
        '<a href="' + FORM_RESPONSES_URL + '" style="display:inline-block;background:' + BRAND_COLOR + ';color:#fff;text-decoration:none;font-size:15px;font-weight:800;padding:15px 40px;border-radius:10px;">응답 전체 보기</a>' +
      '</td></tr>' +
    '</table>' +
    '<div style="text-align:center;font-size:12px;color:#a7adb7;margin-top:16px;">&copy; ' + esc(BRAND) + '</div>' +
  '</div>';
}
// ▲▲▲ 메일 디자인 끝 ▲▲▲

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
