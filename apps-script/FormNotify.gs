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
 *
 * 이 스크립트는 폼 질문 '제목'을 하드코딩해 찾지 않고, 실제 응답을 폼 순서대로 읽어
 * (1) 핵심 6개 항목을 상단에 크게 요약 → (2) 전체 응답을 그 아래에 모두 표시합니다.
 */

var NOTIFY_TO   = 'dnslwkatn1@gmail.com';   // 받는 메일
var BRAND       = '철거의 정석';
var SITE_LABEL  = 'AI 견적 상세페이지';
var BRAND_COLOR = '#2F6BF6';
var FORM_RESPONSES_URL = 'https://docs.google.com/forms/d/1R9ktuWKnXr0gydCTw2t0FoWHTxvinEEIMerusPqqdvY/edit#responses';

// 핵심 요약에 뽑아 쓸 항목 — 질문 제목에 아래 단어가 포함되면 그 값을 사용합니다.
// (폼 질문 문구가 조금 바뀌어도 매칭되도록 '포함' 방식으로 찾습니다.)
var KEY = {
  name:     ['이름', '업체'],
  building: ['공간 유형', '공간유형', '공간'],
  area:     ['평수', '평'],
  restore:  ['원상복구', '원복'],
  total:    ['예상 견적', '견적 금액', '견적서에 표시', '금액']
};

function onFormSubmit(e) {
  // 폼 순서대로 [{title, value}] 목록 생성. 폼/스프레드시트 트리거 모두 지원.
  var rows = [];
  if (e && e.response && typeof e.response.getItemResponses === 'function') {
    var items = e.response.getItemResponses();
    for (var i = 0; i < items.length; i++) {
      rows.push({ title: items[i].getItem().getTitle(), value: normalize(items[i].getResponse()) });
    }
  } else if (e && e.namedValues) {
    for (var k in e.namedValues) {
      if (/타임스탬프|timestamp/i.test(k)) continue;
      rows.push({ title: k, value: normalize(e.namedValues[k]) });
    }
  }

  var now = Utilities.formatDate(new Date(), 'Asia/Seoul', 'yyyy-MM-dd HH:mm');
  var name = pick(rows, KEY.name) || '고객';
  var subject = '[' + BRAND + '] 새 상담 신청 · ' + name +
                ' / ' + (pick(rows, KEY.building) || '-') +
                (pick(rows, KEY.area) ? ' ' + pick(rows, KEY.area) + '평' : '');

  GmailApp.sendEmail(NOTIFY_TO, subject, plainBody(rows, now), {
    name: BRAND,
    htmlBody: buildHtml(rows, now)
  });
}

// 체크박스(배열)/공백 정리
function normalize(v) {
  if (Array.isArray(v)) v = v.filter(function (x) { return String(x).trim() !== ''; }).join(', ');
  return (v == null ? '' : String(v)).trim();
}

// 제목에 힌트 단어가 포함된 첫 응답값 반환
function pick(rows, hints) {
  for (var i = 0; i < rows.length; i++) {
    for (var j = 0; j < hints.length; j++) {
      if (rows[i].title.indexOf(hints[j]) > -1 && rows[i].value) return rows[i].value;
    }
  }
  return '';
}

// 현장 주소 + 상세 주소 합치기
function pickAddress(rows) {
  var base = '', detail = '';
  for (var i = 0; i < rows.length; i++) {
    var t = rows[i].title;
    if (!base && t.indexOf('현장') > -1 && t.indexOf('주소') > -1) base = rows[i].value;
    if (!detail && t.indexOf('상세') > -1 && t.indexOf('주소') > -1) detail = rows[i].value;
  }
  return (base + (detail ? ' ' + detail : '')).trim();
}

function plainBody(rows, now) {
  var out = [BRAND + ' 새 상담 신청 (' + now + ')', ''];
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].value) out.push(rows[i].title + ': ' + rows[i].value);
  }
  return out.join('\n');
}

// ▼▼▼ 메일 디자인 — 형식 바꾸려면 이 함수만 수정 ▼▼▼
function buildHtml(rows, now) {
  // 핵심 요약 6개
  var summary = [
    ['이름 / 업체명', pick(rows, KEY.name)],
    ['현장 주소',     pickAddress(rows)],
    ['공간 유형',     pick(rows, KEY.building)],
    ['평수',          pick(rows, KEY.area) ? pick(rows, KEY.area) + '평' : ''],
    ['원상복구 여부', pick(rows, KEY.restore)],
    ['AI 견적 비용',  pick(rows, KEY.total)]
  ];

  var keyRow = function (label, value) {
    return '' +
      '<tr>' +
        '<td style="padding:13px 16px;font-size:14px;font-weight:700;color:#4b5563;width:120px;vertical-align:top;background:#f6f8fc;border-bottom:1px solid #eaeef5;">' + esc(label) + '</td>' +
        '<td style="padding:13px 16px;font-size:16px;font-weight:700;color:#111827;vertical-align:top;border-bottom:1px solid #eaeef5;white-space:pre-line;">' + (value ? esc(value) : '<span style="color:#c3c9d4;font-weight:500;">미입력</span>') + '</td>' +
      '</tr>';
  };
  var summaryHtml = '';
  for (var i = 0; i < summary.length; i++) summaryHtml += keyRow(summary[i][0], summary[i][1]);

  // 전체 응답(폼 순서대로, 빈 값 생략)
  var detailRow = function (label, value) {
    if (!value) return '';
    return '' +
      '<tr><td style="padding:14px 0 4px;font-size:13px;font-weight:700;color:#111827;">' + esc(label) + '</td></tr>' +
      '<tr><td style="padding:0 0 14px;font-size:15px;color:#374151;line-height:1.5;border-bottom:1px solid #f0f2f5;white-space:pre-line;">' + esc(value) + '</td></tr>';
  };
  var detailHtml = '';
  for (var j = 0; j < rows.length; j++) detailHtml += detailRow(rows[j].title, rows[j].value);
  if (!detailHtml) detailHtml = '<tr><td style="padding:14px 0;font-size:14px;color:#8a929c;">전체 응답을 불러오지 못했습니다. 아래 \'응답 전체 보기\'에서 확인해 주세요.</td></tr>';

  var meta = function (label, value) {
    return '<tr><td style="padding:3px 0;font-size:13px;color:#8a929c;width:78px;">' + esc(label) + '</td>' +
           '<td style="padding:3px 0;font-size:13px;color:#374151;">' + esc(value) + '</td></tr>';
  };

  return '' +
  '<div style="margin:0;padding:24px 12px;background:#eceff4;font-family:-apple-system,BlinkMacSystemFont,\'Malgun Gothic\',sans-serif;">' +
    '<table role="presentation" align="center" width="520" style="max-width:520px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;margin:0 auto;box-shadow:0 6px 24px rgba(20,30,60,.08);">' +
      '<tr><td style="padding:36px 40px 8px;text-align:center;">' +
        '<div style="font-size:14px;font-weight:700;color:#8a929c;letter-spacing:-.01em;">' + esc(BRAND) + '</div>' +
        '<div style="font-size:24px;font-weight:800;color:#111827;margin-top:14px;letter-spacing:-.02em;">' +
          '<span style="color:' + BRAND_COLOR + ';">새 상담 신청</span>이 접수되었습니다.' +
        '</div>' +
      '</td></tr>' +
      '<tr><td style="padding:20px 40px 6px;">' +
        '<table role="presentation" width="100%">' +
          meta('등록위치', SITE_LABEL) +
          meta('등록시각', now) +
        '</table>' +
      '</td></tr>' +

      // ── 핵심 요약 카드 (첫 화면에서 바로 보이는 6개 항목) ──
      '<tr><td style="padding:16px 40px 4px;">' +
        '<div style="font-size:15px;font-weight:800;color:#111827;margin-bottom:10px;">핵심 요약</div>' +
        '<table role="presentation" width="100%" style="border:1px solid #eaeef5;border-radius:12px;border-collapse:separate;overflow:hidden;">' +
          summaryHtml +
        '</table>' +
      '</td></tr>' +

      // ── 전체 응답 ──
      '<tr><td style="padding:22px 40px 4px;">' +
        '<div style="font-size:15px;font-weight:800;color:#111827;border-bottom:2px solid #111827;padding-bottom:8px;">전체 상담 정보</div>' +
      '</td></tr>' +
      '<tr><td style="padding:0 40px 8px;">' +
        '<table role="presentation" width="100%">' + detailHtml + '</table>' +
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
