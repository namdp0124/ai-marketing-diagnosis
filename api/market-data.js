function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(payload));
}

function compact(value, fallback) {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed || fallback;
}

function normalizeItems(data) {
  const body = data && data.response && data.response.body ? data.response.body : data && data.body ? data.body : {};
  const rawItems = body.items && body.items.item ? body.items.item : body.items;
  if (!rawItems) return [];
  return Array.isArray(rawItems) ? rawItems : [rawItems];
}

function getBody(data) {
  if (data && data.response && data.response.body) return data.response.body;
  if (data && data.body) return data.body;
  return {};
}

function getHeader(data) {
  if (data && data.response && data.response.header) return data.response.header;
  if (data && data.header) return data.header;
  return {};
}

function isNoDataResponse(header) {
  const code = compact(header.resultCode, "");
  const message = compact(header.resultMsg, "");
  return code.includes("NODATA") || code.includes("NO_DATA") || message.includes("NODATA") || message.includes("NO_DATA");
}

function countBy(items, getter) {
  const counts = new Map();
  items.forEach(item => {
    const key = compact(getter(item), "");
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));
}

function parseNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function hasCoordinates(payload) {
  return parseNumber(payload.longitude) !== null && parseNumber(payload.latitude) !== null;
}

const DISTRICTS = {
  "동구": "29110",
  "서구": "29140",
  "남구": "29155",
  "북구": "29170",
  "광산구": "29200"
};

const REGION_TO_DISTRICT = {
  "충장로/동명동": "동구",
  "상무지구": "서구",
  "첨단지구": "광산구",
  "수완지구": "광산구",
  "전대후문": "북구",
  "양림동": "남구",
  "송정역": "광산구",
  "봉선동": "남구",
  "백운동/남구": "남구"
};

const INDUSTRY_KEYWORDS = {
  "카페": ["카페", "커피", "다방", "음료", "차"],
  "음식점": ["음식", "식당", "한식", "백반", "분식", "일식", "중식", "양식", "치킨", "피자", "고기", "갈비", "국수", "주점"],
  "뷰티": ["미용", "헤어", "네일", "피부", "속눈썹", "마사지", "화장품", "뷰티"],
  "의류": ["의류", "패션", "옷", "섬유", "신발", "잡화"],
  "학원": ["학원", "교습", "교육", "독서실", "공부방"],
  "공방/소품": ["공방", "공예", "소품", "선물", "문구", "생활용품", "인테리어"],
  "서비스": ["서비스", "수리", "세탁", "사진", "부동산", "상담", "운동", "헬스"]
};

const MARKET_ARCHETYPES = [
  {
    name: "야간 모임형",
    keywords: ["주점", "호프", "술", "맥주", "소주", "노래", "고기", "치킨", "포차", "회식", "바", "BAR", "유흥"]
  },
  {
    name: "업무형",
    keywords: ["커피", "카페", "도시락", "분식", "백반", "편의점", "문구", "복사", "세탁", "부동산", "사무", "식당"]
  },
  {
    name: "생활밀착형",
    keywords: ["미용", "세탁", "수리", "병원", "약국", "편의점", "식료품", "생활", "피부", "네일", "헬스"]
  },
  {
    name: "교육·가족형",
    keywords: ["학원", "교습", "교육", "독서실", "문구", "아동", "키즈", "태권도", "피아노", "영어"]
  },
  {
    name: "취향·체류형",
    keywords: ["카페", "디저트", "제과", "소품", "공방", "의류", "패션", "사진", "베이커리", "미용", "꽃"]
  },
  {
    name: "방문·이동형",
    keywords: ["편의점", "숙박", "여행", "운송", "주차", "음식", "카페", "렌터카", "택시"]
  }
];

const COMPLEMENTARY_RULES = {
  "카페": ["제과제빵", "디저트", "공방", "소품", "학원", "미용", "꽃"],
  "음식점": ["카페", "편의점", "주점", "미용", "노래", "숙박"],
  "뷰티": ["카페", "의류", "사진", "네일", "피부", "화장품", "소품"],
  "의류": ["카페", "미용", "사진", "신발", "잡화", "소품", "네일"],
  "학원": ["문구", "카페", "분식", "편의점", "서점", "독서실"],
  "공방/소품": ["카페", "의류", "꽃", "사진", "디저트", "문구"],
  "서비스": ["카페", "편의점", "미용", "세탁", "식당", "운동"]
};

function resolveDistrictName(payload) {
  const requested = compact(payload.district, "");
  if (DISTRICTS[requested]) return requested;
  const region = compact(payload.region, "");
  return REGION_TO_DISTRICT[region] || "동구";
}

function matchesIndustry(item, industry) {
  return matchesIndustryWithCodes(item, industry, []);
}

function matchesIndustryWithCodes(item, industry, industryCodes) {
  const codeSet = new Set(industryCodes.map(code => code.code).filter(Boolean));
  if (codeSet.size && codeSet.has(compact(item.indsSclsCd, ""))) return true;

  const keywords = INDUSTRY_KEYWORDS[industry] || [];
  if (!keywords.length) return false;
  const text = [
    item.indsLclsNm,
    item.indsMclsNm,
    item.indsSclsNm,
    item.ksicNm,
    item.bizesNm
  ].filter(Boolean).join(" ");
  return keywords.some(keyword => text.includes(keyword));
}

function buildDensityLabel(count, sampleSize) {
  if (!sampleSize) return "판단 보류";
  const ratio = count / sampleSize;
  if (count >= 40 || ratio >= 0.12) return "높음";
  if (count >= 15 || ratio >= 0.06) return "보통";
  return "낮음";
}

function itemText(item) {
  return [
    item.indsLclsNm,
    item.indsMclsNm,
    item.indsSclsNm,
    item.ksicNm,
    item.bizesNm
  ].filter(Boolean).join(" ");
}

function scoreMarketArchetypes(items) {
  const scored = MARKET_ARCHETYPES.map(type => {
    const count = items.reduce((sum, item) => {
      const text = itemText(item);
      return sum + (type.keywords.some(keyword => text.includes(keyword)) ? 1 : 0);
    }, 0);
    return { name: type.name, count };
  })
    .filter(item => item.count > 0)
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "ko"));

  const top = scored.slice(0, 2);
  const label = top.length >= 2
    ? `${top[0].name} + ${top[1].name} 혼합`
    : top.length === 1
    ? top[0].name
    : "표본 부족";

  return { label, archetypes: scored.slice(0, 4) };
}

function isSimilarToIndustry(categoryName, industry) {
  const text = compact(categoryName, "");
  const keywords = INDUSTRY_KEYWORDS[industry] || [];
  return keywords.some(keyword => text.includes(keyword));
}

function buildOpportunityIndustries(topCategories, industry) {
  const fromData = topCategories
    .map(item => compact(item.name, ""))
    .filter(name => name && !isSimilarToIndustry(name, industry));
  const fromRule = COMPLEMENTARY_RULES[industry] || ["카페", "미용", "의류", "학원"];
  return [...new Set([...fromData, ...fromRule])].slice(0, 4);
}

function buildTargetCustomer(payload, archetypeLabel) {
  const customer = compact(payload.customerGroup, "핵심 고객");
  const channel = compact(payload.salesChannel, "주요 채널");
  const operation = compact(payload.operationType, "운영 형태");
  if (archetypeLabel.includes("야간")) return `${customer} + 퇴근 후·주말 방문 고객`;
  if (archetypeLabel.includes("교육")) return `${customer} + 학부모·동반 방문 고객`;
  if (archetypeLabel.includes("업무")) return `${customer} + 점심/퇴근 전후 ${channel} 확인 고객`;
  if (archetypeLabel.includes("취향")) return `${customer} + 저장하고 비교한 뒤 방문하는 고객`;
  return `${customer} + ${operation} 접점에서 바로 선택하는 고객`;
}

function buildRecommendedMessage(payload, archetypeLabel) {
  const industry = compact(payload.industry, "매장");
  const channel = compact(payload.salesChannel, "첫 화면");
  if (archetypeLabel.includes("야간")) return `퇴근 후 바로 들를 이유를 첫 문장에 넣고, ${industry} 선택 장면을 보여주기`;
  if (archetypeLabel.includes("교육")) return `아이/가족 동선에서 왜 ${industry}을 선택해야 하는지 첫 문장에 넣기`;
  if (archetypeLabel.includes("업무")) return `점심·퇴근 전후에 ${channel}에서 확인할 핵심 장점 1개를 먼저 보여주기`;
  if (archetypeLabel.includes("취향")) return `저장하고 다시 볼 만한 취향 포인트를 ${channel} 첫 줄에 고정하기`;
  return `${channel} 첫 문장을 지역명보다 선택 이유 중심으로 바꾸기`;
}

function buildMarketCaution(payload, archetypeLabel) {
  const region = compact(payload.region, "이 상권");
  const industry = compact(payload.industry, "업종");
  const base = `${region}를 단순한 한 가지 고객 상권으로만 보지 않기`;
  if (archetypeLabel.includes("혼합")) return `${base}. ${industry}에서는 시간대·방문목적별 문구를 나눠야 합니다.`;
  return `${base}. 업종, 나이대, 판매 채널, 운영 형태를 같이 보고 해석해야 합니다.`;
}

function buildCollaborationIdeas(opportunityIndustries, payload) {
  const industry = compact(payload.industry, "우리 매장");
  return opportunityIndustries.slice(0, 3).map(name => {
    if (name.includes("카페") || name.includes("디저트") || name.includes("제과")) return `${name}와 영수증/방문 인증 교차 혜택`;
    if (name.includes("미용") || name.includes("의류") || name.includes("사진")) return `${name}와 스타일·촬영·방문 전후 패키지`;
    if (name.includes("학원") || name.includes("문구") || name.includes("독서")) return `${name}와 평일 낮/하교 시간대 쿠폰`;
    return `${name} 방문 고객이 ${industry}을 함께 떠올리게 하는 7일 제휴 이벤트`;
  });
}

function formatChangeDate() {
  const configured = compact(process.env.SMALLBIZ365_RECENT_DATE, "");
  if (/^\d{8}$/.test(configured)) return configured;
  const date = new Date();
  date.setDate(date.getDate() - 30);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0")
  ].join("");
}

function summarizeRadiusComparisons(comparisons, industry) {
  if (!comparisons.length) return "좌표가 없어 반경별 경쟁도는 아직 비교하지 않았습니다.";
  return comparisons
    .map(item => `${item.radiusMeters}m ${industry} 후보 ${item.sameIndustryCount}개/${item.sampleCount}개(${item.competitionDensity})`)
    .join(", ");
}

async function fetchApi({ serviceKey, path, params, allowNoData = false }) {
  const endpoint = `https://apis.data.go.kr/B553077/api/open/sdsc2/${path}`;
  const encodedServiceKey = serviceKey.includes("%") ? serviceKey : encodeURIComponent(serviceKey);
  const searchParams = new URLSearchParams({ ...params, type: "json" });

  const response = await fetch(`${endpoint}?serviceKey=${encodedServiceKey}&${searchParams.toString()}`);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    throw new Error("소상공인365 API 응답을 JSON으로 읽지 못했습니다. 인증키 상태를 확인해 주세요.");
  }

  if (!response.ok) {
    const header = getHeader(data);
    throw new Error(header.resultMsg || "소상공인365 API 호출에 실패했습니다.");
  }

  const header = getHeader(data);
  const resultCode = compact(header.resultCode, "00");
  if (allowNoData && isNoDataResponse(header)) {
    return data;
  }
  if (resultCode !== "00" && resultCode !== "NORMAL_CODE") {
    throw new Error(header.resultMsg || "소상공인365 API에서 오류 응답을 받았습니다.");
  }

  return data;
}

async function fetchPagedItems({ serviceKey, path, params, maxPages, allowNoData = false }) {
  const firstPage = await fetchApi({
    serviceKey,
    path,
    params: { ...params, pageNo: "1", numOfRows: "1000" },
    allowNoData
  });
  if (isNoDataResponse(getHeader(firstPage))) {
    return {
      items: [],
      totalCount: 0,
      header: getHeader(firstPage),
      pagesFetched: 1
    };
  }
  const firstBody = getBody(firstPage);
  const totalCount = Number(firstBody.totalCount || 0);
  let items = normalizeItems(firstPage);

  const totalPages = Math.ceil(totalCount / 1000);
  const pagesToFetch = Math.min(maxPages, totalPages || 1);
  for (let pageNo = 2; pageNo <= pagesToFetch; pageNo += 1) {
    const pageData = await fetchApi({
      serviceKey,
      path,
      params: { ...params, pageNo: String(pageNo), numOfRows: "1000" },
      allowNoData
    });
    items = items.concat(normalizeItems(pageData));
  }

  return {
    items,
    totalCount,
    header: getHeader(firstPage),
    pagesFetched: pagesToFetch
  };
}

async function fetchAdministrativeStores({ serviceKey, districtCode, maxPages }) {
  const attempts = [
    {
      path: "baroApi",
      params: { resId: "store", catId: "dong", divId: "signguCd", key: districtCode }
    },
    {
      path: "storeListInDong",
      params: { divId: "signguCd", key: districtCode }
    }
  ];

  let lastResult = null;
  for (const attempt of attempts) {
    const result = await fetchPagedItems({
      serviceKey,
      path: attempt.path,
      params: attempt.params,
      maxPages,
      allowNoData: true
    });
    if (result.items.length) {
      return { ...result, sourcePath: attempt.path };
    }
    lastResult = { ...result, sourcePath: attempt.path };
  }
  return lastResult || { items: [], totalCount: 0, header: {}, pagesFetched: 0, sourcePath: "" };
}

async function fetchIndustryCodes(serviceKey, industry) {
  const keywords = INDUSTRY_KEYWORDS[industry] || [];
  if (!keywords.length) return [];

  try {
    const data = await fetchApi({
      serviceKey,
      path: "smallUpjongList",
      params: { pageNo: "1", numOfRows: "1000" },
      allowNoData: true
    });
    return normalizeItems(data)
      .map(item => {
        const name = compact(item.indsSclsNm, "");
        const text = [item.indsLclsNm, item.indsMclsNm, item.indsSclsNm].filter(Boolean).join(" ");
        const score = keywords.reduce((sum, keyword) => sum + (text.includes(keyword) ? 1 : 0), 0);
        return {
          code: compact(item.indsSclsCd, ""),
          name,
          middleName: compact(item.indsMclsNm, ""),
          largeName: compact(item.indsLclsNm, ""),
          score
        };
      })
      .filter(item => item.code && item.score > 0)
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ko"))
      .slice(0, 10);
  } catch (error) {
    return [];
  }
}

async function fetchNearbyZones({ serviceKey, longitude, latitude, radius }) {
  try {
    const data = await fetchApi({
      serviceKey,
      path: "storeZoneInRadius",
      params: {
        cx: String(longitude),
        cy: String(latitude),
        radius: String(radius),
        pageNo: "1",
        numOfRows: "20"
      },
      allowNoData: true
    });
    return normalizeItems(data).slice(0, 6).map(item => ({
      id: compact(item.trarNo || item.trdarNo || item.mainTrarNo, ""),
      name: compact(item.mainTrarNm || item.trarNm || item.trdarNm || item.signguNm || item.adongNm, "상권명 미확인"),
      district: compact(item.signguNm || item.signguCd, ""),
      type: compact(item.trarTypeNm || item.trdarTypeNm || item.ctprvnNm, "")
    }));
  } catch (error) {
    return [];
  }
}

async function fetchZonesInAdmi({ serviceKey, districtCode }) {
  try {
    const data = await fetchApi({
      serviceKey,
      path: "storeZoneInAdmi",
      params: {
        divId: "signguCd",
        key: districtCode,
        pageNo: "1",
        numOfRows: "100"
      },
      allowNoData: true
    });
    return normalizeItems(data).slice(0, 8).map(item => ({
      id: compact(item.trarNo || item.trdarNo || item.mainTrarNo, ""),
      name: compact(item.mainTrarNm || item.trarNm || item.trdarNm || item.signguNm || item.adongNm, "상권명 미확인"),
      district: compact(item.signguNm || item.signguCd, ""),
      type: compact(item.trarTypeNm || item.trdarTypeNm || item.ctprvnNm, "")
    })).filter(item => item.id || item.name !== "상권명 미확인");
  } catch (error) {
    return [];
  }
}

async function fetchStoresInArea({ serviceKey, zone, maxPages, industry, industryCodes }) {
  if (!zone || !zone.id) return null;
  const attempts = [
    { divId: "trarNo", key: zone.id },
    { key: zone.id }
  ];
  for (const params of attempts) {
    try {
      const result = await fetchPagedItems({
        serviceKey,
        path: "storeListInArea",
        params,
        maxPages,
        allowNoData: true
      });
      if (result.items.length) {
        return {
          zone,
          totalCount: result.totalCount,
          pagesFetched: result.pagesFetched,
          ...summarizeStores({ items: result.items, industry, industryCodes })
        };
      }
    } catch (error) {
      // Keep the main diagnosis available even when this optional endpoint is unavailable.
    }
  }
  return { zone, totalCount: 0, pagesFetched: 0, sampleCount: 0, sameIndustryCount: 0, competitionDensity: "판단 보류", topCategories: [], sampleStores: [] };
}

async function fetchUpjongBenchmark({ serviceKey, industryCode, maxPages, industry, industryCodes }) {
  if (!industryCode || !industryCode.code) return null;
  try {
    const result = await fetchPagedItems({
      serviceKey,
      path: "storeListInUpjong",
      params: {
        divId: "indsSclsCd",
        key: industryCode.code
      },
      maxPages: Math.min(maxPages, 1),
      allowNoData: true
    });
    return {
      code: industryCode.code,
      name: industryCode.name,
      totalCount: result.totalCount,
      pagesFetched: result.pagesFetched,
      ...summarizeStores({ items: result.items, industry, industryCodes })
    };
  } catch (error) {
    return null;
  }
}

async function fetchRecentChanges({ serviceKey, changeDate, maxPages, industry, industryCodes }) {
  const attempts = [
    { key: changeDate },
    { stdrDt: changeDate },
    { chgDe: changeDate }
  ];
  for (const params of attempts) {
    try {
      const result = await fetchPagedItems({
        serviceKey,
        path: "storeListByDate",
        params,
        maxPages: Math.min(maxPages, 1),
        allowNoData: true
      });
      return {
        changeDate,
        totalCount: result.totalCount,
        pagesFetched: result.pagesFetched,
        ...summarizeStores({ items: result.items, industry, industryCodes }),
        note: result.items.length
          ? `${changeDate} 수정일자 표본 기준 신규/변경 업소 흐름을 참고했습니다.`
          : `${changeDate} 수정일자 기준으로 확인된 변경 표본이 없습니다.`
      };
    } catch (error) {
      // Try the next documented-looking parameter name.
    }
  }
  return {
    changeDate,
    totalCount: 0,
    sampleCount: 0,
    sameIndustryCount: 0,
    competitionDensity: "판단 보류",
    topCategories: [],
    sampleStores: [],
    note: "최근 변화 데이터는 endpoint 응답 형식 확인 후 더 정확하게 확장할 수 있습니다."
  };
}

async function fetchRadiusComparisons({ serviceKey, longitude, latitude, maxPages, industry, industryCodes }) {
  if (longitude === null || latitude === null) return [];
  const radiuses = [300, 500, 1000];
  const comparisons = [];
  for (const currentRadius of radiuses) {
    try {
      const data = await fetchPagedItems({
        serviceKey,
        path: "storeListInRadius",
        params: {
          radius: String(currentRadius),
          cx: String(longitude),
          cy: String(latitude)
        },
        maxPages: Math.min(maxPages, 1),
        allowNoData: true
      });
      const summary = summarizeStores({ items: data.items, industry, industryCodes });
      comparisons.push({
        radiusMeters: currentRadius,
        totalCount: data.totalCount,
        sampleCount: summary.sampleCount,
        sameIndustryCount: summary.sameIndustryCount,
        competitionDensity: summary.competitionDensity,
        topCategories: summary.topCategories.slice(0, 3)
      });
    } catch (error) {
      comparisons.push({
        radiusMeters: currentRadius,
        totalCount: 0,
        sampleCount: 0,
        sameIndustryCount: 0,
        competitionDensity: "판단 보류",
        topCategories: []
      });
    }
  }
  return comparisons;
}

function summarizeStores({ items, industry, industryCodes }) {
  const sameIndustryItems = items.filter(item => matchesIndustryWithCodes(item, industry, industryCodes));
  const topCategories = countBy(items, item => item.indsMclsNm || item.indsLclsNm).slice(0, 5);
  return {
    sampleCount: items.length,
    sameIndustryCount: sameIndustryItems.length,
    competitionDensity: buildDensityLabel(sameIndustryItems.length, items.length),
    topCategories,
    sampleStores: items.slice(0, 6).map(item => ({
      name: compact(item.bizesNm, "상호명 없음"),
      category: compact(item.indsMclsNm || item.indsSclsNm || item.indsLclsNm, "업종 미분류"),
      smallCategory: compact(item.indsSclsNm, ""),
      dong: compact(item.adongNm || item.ldongNm, ""),
      address: compact(item.rdnmAdr || item.lnoAdr, ""),
      longitude: compact(item.lon || item.longitude, ""),
      latitude: compact(item.lat || item.latitude, "")
    }))
  };
}

function buildMarketInsight({ items, primary, topCategories, payload, radiusComparisons, recentChanges }) {
  const industry = compact(payload.industry, "기타");
  const archetype = scoreMarketArchetypes(items.length ? items : []);
  const characterLabel = archetype.label;
  const opportunityIndustries = buildOpportunityIndustries(topCategories, industry);
  const targetCustomer = buildTargetCustomer(payload, characterLabel);
  const recommendedMessage = buildRecommendedMessage(payload, characterLabel);
  const caution = buildMarketCaution(payload, characterLabel);
  const collaborationIdeas = buildCollaborationIdeas(opportunityIndustries, payload);
  const recentChangeSummary = recentChanges && recentChanges.sampleCount
    ? `수정일자 ${recentChanges.changeDate} 표본 ${recentChanges.sampleCount}개 중 ${recentChanges.sameIndustryCount}개가 ${industry} 유사 업소입니다.`
    : recentChanges && recentChanges.note
    ? recentChanges.note
    : "최근 변화는 수정일자 기준 데이터 연결 후 더 정교하게 볼 수 있습니다.";

  return {
    characterLabel,
    archetypes: archetype.archetypes,
    sameIndustryDensity: primary.competitionDensity,
    opportunityIndustries,
    targetCustomer,
    recommendedMessage,
    caution,
    collaborationIdeas,
    radiusComparisonSummary: summarizeRadiusComparisons(radiusComparisons, industry),
    radiusComparisons,
    recentChangeSummary,
    expansionNote: "회식상권·상권분석 파일데이터는 별도 파일데이터를 확보하면 시간대/연령대/매출 흐름까지 확장할 수 있습니다."
  };
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    return sendJson(res, 200, { ok: true });
  }

  if (req.method !== "POST") {
    return sendJson(res, 405, { error: "POST 요청만 사용할 수 있습니다." });
  }

  const serviceKey = process.env.SMALLBIZ365_SERVICE_KEY || process.env.SMALLBIZ_API_KEY;
  if (!serviceKey) {
    return sendJson(res, 500, {
      error: "Vercel 환경변수 SMALLBIZ365_SERVICE_KEY가 아직 등록되지 않았습니다."
    });
  }

  let payload = req.body;
  if (typeof payload === "string") {
    try {
      payload = JSON.parse(payload);
    } catch (error) {
      return sendJson(res, 400, { error: "요청 데이터를 읽을 수 없습니다." });
    }
  }

  if (!payload || typeof payload !== "object") {
    return sendJson(res, 400, { error: "상권 조회에 필요한 정보가 부족합니다." });
  }

  const districtName = resolveDistrictName(payload);
  const districtCode = DISTRICTS[districtName];
  const dongName = compact(payload.dongName, "");
  const industry = compact(payload.industry, "기타");
  const longitude = parseNumber(payload.longitude);
  const latitude = parseNumber(payload.latitude);
  const radius = Math.max(100, Math.min(3000, Math.round(parseNumber(payload.radius) || 500)));
  const maxPages = Math.max(1, Math.min(3, Number(process.env.SMALLBIZ365_MAX_PAGES) || 2));

  try {
    const industryCodes = await fetchIndustryCodes(serviceKey, industry);
    const districtData = await fetchAdministrativeStores({
      serviceKey,
      districtCode,
      maxPages
    });
    const totalCount = districtData.totalCount;
    const items = districtData.items;

    const filteredItems = dongName
      ? items.filter(item => compact(item.adongNm, "").includes(dongName) || compact(item.ldongNm, "").includes(dongName) || compact(item.rdnmAdr, "").includes(dongName) || compact(item.lnoAdr, "").includes(dongName))
      : items;
    const targetItems = filteredItems.length ? filteredItems : items;
    const administrative = summarizeStores({ items: targetItems, industry, industryCodes });
    const topDongs = countBy(items, item => item.adongNm).slice(0, 5);
    const header = districtData.header;
    const areaName = dongName ? `${districtName} ${dongName}` : districtName;
    let primary = administrative;
    let primaryItems = targetItems;
    let radiusAnalysis = null;
    let nearbyZones = [];
    let radiusComparisons = [];

    if (longitude !== null && latitude !== null) {
      const radiusData = await fetchPagedItems({
        serviceKey,
        path: "storeListInRadius",
        params: {
          radius: String(radius),
          cx: String(longitude),
          cy: String(latitude)
        },
        maxPages,
        allowNoData: true
      });
      radiusAnalysis = {
        ...summarizeStores({ items: radiusData.items, industry, industryCodes }),
        radiusMeters: radius,
        totalCount: radiusData.totalCount,
        pagesFetched: radiusData.pagesFetched
      };
      if (radiusAnalysis.sampleCount) {
        primary = radiusAnalysis;
        primaryItems = radiusData.items;
      }
      nearbyZones = await fetchNearbyZones({ serviceKey, longitude, latitude, radius });
      radiusComparisons = await fetchRadiusComparisons({
        serviceKey,
        longitude,
        latitude,
        maxPages,
        industry,
        industryCodes
      });
    }

    const administrativeZones = await fetchZonesInAdmi({ serviceKey, districtCode });
    const zoneAnalysis = await fetchStoresInArea({
      serviceKey,
      zone: administrativeZones[0],
      maxPages,
      industry,
      industryCodes
    });
    const upjongBenchmark = await fetchUpjongBenchmark({
      serviceKey,
      industryCode: industryCodes[0],
      maxPages,
      industry,
      industryCodes
    });
    const recentChanges = await fetchRecentChanges({
      serviceKey,
      changeDate: formatChangeDate(),
      maxPages,
      industry,
      industryCodes
    });
    const marketInsight = buildMarketInsight({
      items: primaryItems,
      primary,
      topCategories: primary.topCategories,
      payload,
      radiusComparisons,
      recentChanges
    });

    const categoryText = primary.topCategories.map(item => `${item.name} ${item.count}개`).join(", ") || "분류 데이터 없음";
    const sampleNote = targetItems.length === filteredItems.length && dongName
      ? `${areaName} 표본 ${targetItems.length}개`
      : `${districtName} 표본 ${targetItems.length}개`;
    const radiusText = radiusAnalysis
      ? ` 매장 좌표 기준 반경 ${radius}m 표본 ${radiusAnalysis.sampleCount}개 중 ${industry} 유사 업소 ${radiusAnalysis.sameIndustryCount}개, 경쟁 밀도는 ${radiusAnalysis.competitionDensity}입니다.`
      : "";
    const codeText = industryCodes.length
      ? ` 공식 업종 소분류 후보는 ${industryCodes.slice(0, 3).map(item => item.name).join(", ")}입니다.`
      : "";
    const zoneText = nearbyZones.length
      ? ` 주변 상권 후보는 ${nearbyZones.map(zone => zone.name).join(", ")}입니다.`
      : "";
    const insightText = marketInsight.characterLabel !== "표본 부족"
      ? ` 상권 성격은 ${marketInsight.characterLabel}으로 읽히며, 기회 업종 후보는 ${marketInsight.opportunityIndustries.join(", ")}입니다.`
      : "";

    return sendJson(res, 200, {
      ok: true,
      source: "소상공인시장진흥공단 상가(상권)정보 API",
      standardMonth: compact(header.stdrYm, ""),
      query: {
        region: compact(payload.region, ""),
        districtName,
        districtCode,
        dongName,
        industry,
        longitude,
        latitude,
        radius,
        pagesFetched: districtData.pagesFetched,
        sourcePath: districtData.sourcePath
      },
      analysisMode: radiusAnalysis ? "radius" : "administrative",
      totalCount,
      sampleCount: primary.sampleCount,
      sameIndustryCount: primary.sameIndustryCount,
      competitionDensity: primary.competitionDensity,
      topCategories: primary.topCategories,
      topDongs,
      sampleStores: primary.sampleStores,
      industryCodes,
      administrative: {
        areaName,
        sampleCount: administrative.sampleCount,
        sameIndustryCount: administrative.sameIndustryCount,
        competitionDensity: administrative.competitionDensity,
        topCategories: administrative.topCategories,
        sampleStores: administrative.sampleStores
      },
      radiusAnalysis,
      radiusComparisons,
      nearbyZones,
      administrativeZones,
      zoneAnalysis,
      upjongBenchmark,
      recentChanges,
      marketInsight,
      summary: `${sampleNote} 기준 ${industry} 유사 업소 ${administrative.sameIndustryCount}개가 잡혔고, 경쟁 밀도는 ${administrative.competitionDensity}으로 보입니다.${radiusText} 주요 업종은 ${categoryText}입니다.${codeText}${zoneText}${insightText}`,
      note: dongName && !filteredItems.length
        ? "입력한 행정동명이 표본에 없어 행정구 표본으로 요약했습니다."
        : targetItems.length
        ? "총 업소 수는 행정구 기준이며, 업종/행정동/반경 분석은 조회 표본 기준입니다."
        : "해당 조건에서 공공데이터 표본이 없어 0개로 표시했습니다. 행정동명을 비우거나 행정구만 선택해 다시 조회해 보세요."
    });
  } catch (error) {
    return sendJson(res, 502, {
      error: error.message || "소상공인365 상권 데이터를 불러오지 못했습니다."
    });
  }
};
