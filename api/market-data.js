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

function resolveDistrictName(payload) {
  const requested = compact(payload.district, "");
  if (DISTRICTS[requested]) return requested;
  const region = compact(payload.region, "");
  return REGION_TO_DISTRICT[region] || "동구";
}

function matchesIndustry(item, industry) {
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

async function fetchPage({ serviceKey, districtCode, pageNo }) {
  const endpoint = "https://apis.data.go.kr/B553077/api/open/sdsc2/storeListInDong";
  const encodedServiceKey = serviceKey.includes("%") ? serviceKey : encodeURIComponent(serviceKey);
  const params = new URLSearchParams({
    divId: "signguCd",
    key: districtCode,
    pageNo: String(pageNo),
    numOfRows: "1000",
    type: "json"
  });

  const response = await fetch(`${endpoint}?serviceKey=${encodedServiceKey}&${params.toString()}`);
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
  if (resultCode !== "00" && resultCode !== "NORMAL_CODE") {
    throw new Error(header.resultMsg || "소상공인365 API에서 오류 응답을 받았습니다.");
  }

  return data;
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
  const maxPages = Math.max(1, Math.min(3, Number(process.env.SMALLBIZ365_MAX_PAGES) || 2));

  try {
    const firstPage = await fetchPage({ serviceKey, districtCode, pageNo: 1 });
    const firstBody = getBody(firstPage);
    const totalCount = Number(firstBody.totalCount || 0);
    let items = normalizeItems(firstPage);

    const totalPages = Math.ceil(totalCount / 1000);
    const pagesToFetch = Math.min(maxPages, totalPages || 1);
    for (let pageNo = 2; pageNo <= pagesToFetch; pageNo += 1) {
      const pageData = await fetchPage({ serviceKey, districtCode, pageNo });
      items = items.concat(normalizeItems(pageData));
    }

    const filteredItems = dongName
      ? items.filter(item => compact(item.adongNm, "").includes(dongName) || compact(item.ldongNm, "").includes(dongName) || compact(item.rdnmAdr, "").includes(dongName) || compact(item.lnoAdr, "").includes(dongName))
      : items;
    const targetItems = filteredItems.length ? filteredItems : items;
    const sameIndustryItems = targetItems.filter(item => matchesIndustry(item, industry));
    const topCategories = countBy(targetItems, item => item.indsMclsNm || item.indsLclsNm).slice(0, 5);
    const topDongs = countBy(items, item => item.adongNm).slice(0, 5);
    const header = getHeader(firstPage);
    const areaName = dongName ? `${districtName} ${dongName}` : districtName;
    const density = buildDensityLabel(sameIndustryItems.length, targetItems.length);
    const categoryText = topCategories.map(item => `${item.name} ${item.count}개`).join(", ") || "분류 데이터 없음";
    const sampleNote = targetItems.length === filteredItems.length && dongName
      ? `${areaName} 표본 ${targetItems.length}개`
      : `${districtName} 표본 ${targetItems.length}개`;

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
        pagesFetched: pagesToFetch
      },
      totalCount,
      sampleCount: targetItems.length,
      sameIndustryCount: sameIndustryItems.length,
      competitionDensity: density,
      topCategories,
      topDongs,
      sampleStores: targetItems.slice(0, 6).map(item => ({
        name: compact(item.bizesNm, "상호명 없음"),
        category: compact(item.indsMclsNm || item.indsSclsNm || item.indsLclsNm, "업종 미분류"),
        dong: compact(item.adongNm || item.ldongNm, ""),
        address: compact(item.rdnmAdr || item.lnoAdr, "")
      })),
      summary: `${sampleNote} 기준 ${industry} 유사 업소 ${sameIndustryItems.length}개가 잡혔고, 경쟁 밀도는 ${density}으로 보입니다. 주요 업종은 ${categoryText}입니다.`,
      note: dongName && !filteredItems.length
        ? "입력한 행정동명이 표본에 없어 행정구 표본으로 요약했습니다."
        : "총 업소 수는 행정구 기준이며, 업종/행정동 분석은 조회 표본 기준입니다."
    });
  } catch (error) {
    return sendJson(res, 502, {
      error: error.message || "소상공인365 상권 데이터를 불러오지 못했습니다."
    });
  }
};
