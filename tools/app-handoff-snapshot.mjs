// Versioned, allowlisted projection for the offline handoff prototype.
export const DIAGNOSIS_VERSION = 'ye-g-1.0';
const choiceFields = {
  industry: ['카페', '음식점', '뷰티', '의류', '학원', '공방/소품', '서비스', '기타'],
  region: ['광주 전체', '충장로/동명동', '상무지구', '첨단지구', '수완지구', '전대후문', '양림동', '송정역', '봉선동', '백운동/남구'],
  operationType: ['오프라인', '온라인', '혼합'],
  businessYear: ['6개월 미만', '6개월~1년', '1~3년', '3년 이상'],
  customerGroup: ['10대', '20대', '30대', '40대', '50대 이상', '다양함'],
  salesChannel: ['현장 방문', '배달', 'SNS/DM', '스마트스토어', '플레이스/지도', '혼합'],
};
const operationChoices = {
  competitor: [
    '주변 상황은 잘 모르겠어요', '비슷한 가게가 많은 것 같아요', '가격 경쟁이 있는 것 같아요',
    '새 가게가 자주 생기는 것 같아요', '유동인구가 줄어든 것 같아요', '우리만의 차이가 잘 안 보여요',
  ],
  goal: [
    '무엇부터 해야 할지 모르겠어요', '방문 손님을 늘리고 싶어요', '문의/예약을 늘리고 싶어요',
    '리뷰를 늘리고 싶어요', '재방문을 늘리고 싶어요', '대표 상품을 더 알리고 싶어요',
    '평일이나 비수기 매출을 보완하고 싶어요',
  ],
};
const questionIds = [
  'message_clear', 'search_ready', 'content_specific', 'conversion_path', 'review_system', 'revisit_device',
  'street_visibility', 'time_strategy', 'competition_clear', 'local_collab', 'tracking', 'fast_action',
];
const priorities = {
  acquisition: ['상권 발견성', '발견성 재설계형', '검색 결과에서 대표 상품과 위치를 확인하기 쉽게 정리하세요.'],
  conversion: ['문의 전환', '문의 전환 누수형', '고객이 문의하거나 예약하는 방법을 한눈에 보이게 정리하세요.'],
  retention: ['재방문 장치', '단골 루틴 공백형', '방문 고객이 다시 찾을 이유를 한 가지 정하고 반응을 기록하세요.'],
  branding: ['차별화 증거', '로컬 증거 부족형', '고객이 매장을 선택할 이유를 보여 주는 사진이나 후기를 먼저 배치하세요.'],
  local: ['상권 적합성', '상권 메시지 불일치형', '주 고객층이 지나가는 시간과 장소에 맞게 안내를 점검하세요.'],
  execution: ['실행 루틴', '실행 루틴 부재형', '이번 주에 할 홍보를 하나 정하고 문의나 방문 반응을 기록하세요.'],
};
const scoreKeys = [...Object.keys(priorities), 'overall'];
const selectFields = (source, choices) => Object.fromEntries(Object.entries(choices).map(([key, options]) => {
  const value = source?.[key];
  if (!options.includes(value)) throw new Error('INVALID_SNAPSHOT');
  return [key, value];
}));
function numberFields(source, keys, min, max) {
  return Object.fromEntries(keys.map(key => {
    const value = source?.[key];
    if (!Number.isInteger(value) || value < min || value > max) throw new Error('INVALID_SNAPSHOT');
    return [key, value];
  }));
}

export function buildHandoffSnapshot(diagnosis, rawAnswers) {
  const profile = selectFields(diagnosis.profile, choiceFields);
  const operations = selectFields(diagnosis.businessContext, operationChoices);
  const answers = numberFields(rawAnswers, questionIds, 1, 5);
  const scores = numberFields(diagnosis.scores, scoreKeys, 0, 100);
  const priorityKey = diagnosis.weakest?.key;
  if (!Object.hasOwn(priorities, priorityKey)) throw new Error('INVALID_SNAPSHOT');
  const [name, type, action] = priorities[priorityKey];
  if (diagnosis.resultType !== `${profile.region} ${profile.industry} ${type}` ||
      diagnosis.weakest.score !== scores[priorityKey] || diagnosis.weakest.name !== name ||
      Object.keys(priorities).some(key => scores[key] < scores[priorityKey])) {
    throw new Error('INVALID_SNAPSHOT');
  }
  return {
    schemaVersion: 1,
    diagnosisVersion: DIAGNOSIS_VERSION,
    profile,
    operations,
    answers,
    result: { scores, type: diagnosis.resultType, priority: { key: priorityKey, name, score: scores[priorityKey] } },
    basicReport: {
      summary: `${diagnosis.resultType} · 실행 준비도 ${scores.overall}점`,
      improvement: name,
      action,
    },
    recommendations: { priorityKey, channel: profile.salesChannel, nextAction: action },
  };
}
