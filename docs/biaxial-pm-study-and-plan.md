# 2축 P-M 상관도(Biaxial Interaction Surface) 이론 스터디 및 구현 계획

작성일: 2026-08-04
개정: 2026-08-04 (설계 결정 4건 확정 반영 / **Phase 0~9 구현 완료**)
대상: `src/engine/*`, `src/App.tsx`

> **구현 상태: Phase 0~9 전부 완료.** 테스트 105개 통과.
> 구현 중 발견된 사항은 §Part 6 에 정리했다.

## 확정된 설계 결정

1. **중공 단면 정식 지원** — `SectionModel.rings: Ring[]`, outer=CCW / hole=CW 부호합산 (§1.10(1b))
2. **1축/2축 완전 통합** — 1축 전용 경로 제거, `Muy=0`이면 자동으로 1축과 동일 (§Phase 8.5)
3. **최소편심(강도설계법)** — 축력 cutoff `φPn ≤ α·φ·Pn0`, 최소모멘트 미적용 (§1.7.1)
4. **최소편심(한계상태설계법)** — 최소모멘트 검토, 강도곡면은 불변 (§1.7.2)

---

# Part 1. 이론 스터디

## 1.1 1축과 2축의 본질적 차이

현행 엔진(`computePM`)은 다음 두 가정 위에 서 있다.

```text
(A) 중립축은 항상 수평이다  ->  clipPolygonAboveY(polygon, yLimit)
(B) 모멘트는 x축 회전 성분 하나뿐이다  ->  mn += force * (bar.y - referenceY)
```

2축에서는 이 두 가정이 모두 깨진다. 차이는 "축이 하나 더 늘었다"가 아니라 **문제의 차원과 해의 성격이 바뀐다**는 것이다.

| 항목 | 1축 | 2축 |
|---|---|---|
| 미지수 | 중립축 깊이 `c` 1개 | 중립축 각도 `θ` + 깊이 `c` 2개 |
| 결과물 | (M, P) 평면의 **곡선** | (Mx, My, P) 공간의 **곡면(surface)** |
| 계산 방향 | 순방향 sweep 1회 | 순방향 sweep은 격자, 검토는 **역해석(2중 반복)** |
| 중립축과 모멘트 관계 | N.A. ⟂ 모멘트 벡터 (대칭단면) | **일반적으로 직교하지 않음** |
| 모멘트 기준점 | 도심으로 대충 넘어감 | **소성중심이 필수** |
| 콘크리트 압축영역 | 사다리꼴/직사각형 | 삼각형·오각형 등 임의 다각형 |
| 검토 | `M_capacity(P)` 와 Mu 비교 | 곡면 내부 판정 + 방향별 사용률 |

## 1.2 수학적 정식화 — 변형률 평면 2-파라미터화

단면 위 임의 점 `(x, y)`의 변형률은 **평면**이다.

```text
ε(x, y) = ε0 + κx·y + κy·x        (3개 자유도)
```

여기서 축력 P가 1개 구속을 걸므로, 강도곡면은 2-파라미터 족이 된다. 실무적으로는 아래처럼 잡는 것이 안정적이다.

```text
n̂ = (cos θ, sin θ)        중립축 법선 단위벡터, 압축측을 향함
s(x,y) = x·cos θ + y·sin θ   n̂ 방향 좌표
s_max  = max{ s(P) : P ∈ 단면 }   최압축 연단
c      = 중립축 깊이 (s_max 로부터)

ε(x,y) = ε_cu · ( s(x,y) - (s_max - c) ) / c
```

- `θ = 90°` (n̂ = (0,1)) 이면 `s = y`, `s_max = box.maxY` → **현행 1축 코드와 완전히 동일**. 즉 현행 엔진은 새 엔진의 `θ=90°` 단면(slice)이다. 이 성질이 회귀 검증의 기준이 된다.
- 등가직사각형 응력블록의 압축영역은 `{ s ≥ s_max - β₁·c }` 인 반평면 절단.

내력:

```text
Pn  = Cc + Σ Fs_i                          (압축 +)
Mnx = Cc·(y_c - y_pc) + Σ Fs_i·(y_i - y_pc)   = Pn · e_y
Mny = Cc·(x_c - x_pc) + Σ Fs_i·(x_i - x_pc)   = Pn · e_x
```

편심벡터 방향:

```text
α_e = atan2(Mnx, Mny) = atan2(e_y, e_x)
```

1축 대칭 케이스에서 `θ = 90°` 이면 `e_x = 0` → `α_e = 90° = θ`. 즉 **대칭 1축에서만 `θ = α_e`가 성립**한다.

## 1.3 [핵심 함정] 중립축 각도 ≠ 모멘트 벡터 직각

2축에서 가장 많이 틀리는 지점이다.

> **틀린 방법**: 하중 편심 방향 `α_e` 만큼 단면을 회전시키고 1축 계산을 그대로 돌린다.

일반 단면에서 `α_e(θ) ≠ θ` 이다. 400×800 직사각형처럼 세장비가 큰 단면에서는 두 각도가 **10~30° 이상 벌어진다**. 물리적으로는 약축 방향으로 편심이 조금만 기울어도 중립축은 훨씬 덜 기울어지기 때문이다. 위 "틀린 방법"은 이 차이를 무시하므로 강도를 과대/과소 평가한다.

결론:

```text
설계 검토 = 주어진 (Pu, Mux, Muy) 에 대해
            α_e(θ, c) = α_e,demand  이고  Pn(θ, c) = Pu  가 되는 (θ, c)를 찾는 역문제
```

→ **2중 반복(outer: θ, inner: c)** 이 2축 엔진의 심장이다.
StructurePoint(PCA)의 ACI 318 biaxial 매뉴얼도 "중립축 각도를 가정하고 반복(iteration)하여 결정한다"고 명시한다.

## 1.4 소성중심(plastic centroid) 기준의 필연성

KDS 14 20 20은 **"압축부재 단면의 편심거리는 소성중심으로부터 축력 작용점까지의 거리로 한다"** 고 규정한다.

현행 코드는 `referenceY = centroid(polygon).y` — **콘크리트 기하 도심**을 쓴다. 철근을 무시하므로 배근이 비대칭이면 순압축점에서 `Mn ≠ 0`이 되는 모순이 이미 존재한다(현행 `computePureCompression`이 실제로 그렇다).

1축·대칭배근에서는 두 점이 일치해서 티가 안 났지만, 2축에서는 곡면 전체가 기울어져 **모든 방향의 검토가 틀어진다**. 반드시 교체해야 한다.

```text
소성중심:
  D = α·fcd·Ac + Σ (fyd - α·fcd)·As_i
  x_pc = [ α·fcd·Ac·x_c + Σ (fyd - α·fcd)·As_i·x_i ] / D
  y_pc = [ α·fcd·Ac·y_c + Σ (fyd - α·fcd)·As_i·y_i ] / D
```

이 기준을 쓰면 순압축점이 정확히 `(Mnx, Mny) = (0, 0)` 에 떨어져 곡면의 꼭짓점이 축 위에 놓인다.

주의: 순인장점은 콘크리트가 없으므로 "인장중심"이 소성중심과 다르다. 비대칭 배근이면 곡면 하단 꼭짓점은 원점에 오지 않는 것이 **정상**이다.

## 1.5 콘크리트 압축영역 적분 — 등가블록의 한계

### 1.5.1 문제

Whitney 등가직사각형 응력블록(`α = 0.85η`, `a = β₁c`)은 **폭이 일정한 압축영역**을 전제로 보정된 계수다. 2축에서는 모서리 압축으로 인해 압축영역이 **삼각형**이 되는 경우가 흔하다. 이때 실제 포물선 응력분포는 폭이 좁은 최압축 연단에서 최대응력을, 폭이 넓은 쪽에서 낮은 응력을 갖는데, 등가블록은 이를 균일 응력으로 뭉개므로 **압축력을 과대평가**한다.

### 1.5.2 코드 근거

Eurocode 2 §3.1.7(3)은 이 문제를 명시적으로 다룬다.

> 압축 연단 방향으로 단면 폭이 **감소**하는 단면에서는 `η·fcd` 값을 **10% 저감**한다.

즉 2축에서 등가블록을 쓸 거면 삼각형/테이퍼 압축영역에 대해 10% 감소를 적용하는 것이 코드 정합적이다. KDS는 이 조항을 직접 갖고 있지 않으므로, 본 프로그램에서는 **옵션 토글**로 제공하고 보고서에 근거를 명시하는 것이 안전하다.

### 1.5.3 두 개의 적분 엔진

| 엔진 | 응력법칙 | 적분 | 용도 |
|---|---|---|---|
| A. 등가블록 | 균일 `α·fcd` | 반평면 클리핑 1회 | 기본, 빠름, 코드 관행 |
| B. 파이버(밴드) | 포물선-직선 `σ(ε)` | n밴드 클리핑 | 정확, 삼각형 압축영역 검증용 |

**엔진 B 알고리즘(권장)**

```text
1) 실제 압축영역 = clip( polygon, s ≥ s_max - c )     ※ β₁ 안 씀
2) s 범위를 N개(50~100) 밴드로 분할
3) 각 밴드 = clip 두 번 → 정확한 면적 A_j 와 도심 (x_j, y_j)
4) ε_j = ε_cu·(s_j - (s_max-c))/c,  σ_j = σ(ε_j)
5) Cc  = Σ σ_j·A_j
   Mcx = Σ σ_j·A_j·(y_j - y_pc)
   Mcy = Σ σ_j·A_j·(x_j - x_pc)
```

기하(면적·도심)는 **정확**하고 응력만 밴드 대표값으로 근사하므로 오차는 O(1/N²). N=50이면 충분하다. 두 엔진이 동일한 클리핑 프리미티브를 공유하므로 추가 기하 코드가 없다.

## 1.6 강도감소계수 φ의 2축 일반화

- KDS의 `ε_t`는 "최외단 인장철근의 순인장변형률"이다. 2축에서 "최외단"은 **중립축에서 인장측으로 가장 먼 철근**이며, `θ`가 돌면 그 철근이 바뀐다.
- 현행 코드의 `maxTensionStrain = max_i(max(0, -ε_i))` 는 이 정의의 올바른 일반화다. **그대로 승계 가능**.

**단, 중요한 부작용**: `φ`가 `θ`와 `c`에 따라 0.65~0.85로 변하므로, 공칭곡면(볼록)에 변동 φ를 곱한 **설계곡면은 볼록성이 깨질 수 있다.** 특히 압축지배↔인장지배 전이 구간 근처에서 곡면이 안쪽으로 접힌다.

→ 검토 판정에서 "원점 기준 볼록 껍질(convex hull) 내부인가" 같은 지름길을 쓰면 안 되고, **반드시 실제 곡면과의 교점을 찾아야 한다.**

## 1.7 최소편심 — 설계법별로 **다른 메커니즘**이다 [확정]

이 항목의 핵심은 두 설계법이 같은 물리(우발편심)를 **정반대 위치에서** 다룬다는 것이다.

```text
강도설계법(kds_strength)   ->  강도(곡면) 쪽을 자른다   : 축력 cutoff
한계상태설계법(bridge_lsd) ->  수요(하중) 쪽을 올린다   : 최소모멘트 검토
```

### 1.7.1 강도설계법 — 축력 cutoff

ACI 318-02부터 최소편심 조항을 **삭제**하고 축력 상한으로 대체했으며, KDS 14 20 20도 같은 체계를 따른다.

```text
φPn ≤ α_limit · φ · Pn0        (띠철근 α=0.80, 나선철근 α=0.85)
Pn0 = α_block·fcd·(Ag - Ast) + fyd·Ast
```

근거: 상한 축력이 곡선 상단부를 잘라내면서 우발편심을 **암묵적으로** 흡수한다. `α=0.80`은 대략 `e≈0.10h`, `α=0.85`는 `e≈0.05h`에 해당하는 편심 효과다. 따라서 **별도의 최소모멘트 요구를 중복 적용하면 안 된다.**

2축 구현은 매우 단순하다.

```text
곡면 상단을 평면 P = α_limit · φ · Pn0 으로 절단(truncate)
-> θ, c 에 무관한 단일 상수. 모든 자오선에 동일 적용.
```

**현행 코드의 문제**: `App.tsx:minimumEccentricityCutoff()` 는 `Mmin = Pmax·e_min` 수평선을 긋는 방식으로, 축력 cutoff와 최소모멘트를 **섞은 하이브리드**다. 강도설계법 경로에서는 최소모멘트 요구를 제거하고 순수 축력 cutoff만 남긴다.

### 1.7.2 한계상태설계법 — 최소모멘트 검토

Eurocode 2 §6.1(4) 체계(KDS 24 14 21이 준용):

```text
e0 = max( h/30 , 20 mm )      h = 검토 방향의 단면 깊이
```

강도곡면은 **손대지 않고**, 작용모멘트를 하한 처리한다.

```text
Mux,check = max( |Mux*| , NEd · e0y / 1000 )    e0y = max(hy/30, 20),  hy = y방향 단면 깊이
Muy,check = max( |Muy*| , NEd · e0x / 1000 )    e0x = max(hx/30, 20),  hx = x방향 단면 폭
```

부호 규약 확인: `Mx = P·e_y` 이므로 **Mux는 y방향 편심**과, `My = P·e_x` 이므로 **Muy는 x방향 편심**과 짝을 이룬다. 짝을 바꿔 쓰는 실수가 잦으니 코드에 주석으로 못박는다.

이 방식의 장점은 **강도곡면이 설계법에 무관하게 순수한 단면 저항만 표현**한다는 것이다. 곡면은 재료계수만 반영하고, 최소편심은 검토 단계에서만 개입한다.

### 1.7.3 [주의] 2축에서 최소모멘트는 편심 방향을 바꾼다

축별로 하한 처리하면 작은 쪽 모멘트가 끌어올려지므로 **편심 방향 `α_e`가 이동한다**.

```text
예)  Mux* = 3000,  Muy* = 0,  NEd·e0x/1000 = 400
     하한 처리 전:  α_e = atan2(3000, 0)   = 90.0°
     하한 처리 후:  α_e = atan2(3000, 400) = 82.4°   <- 7.6° 회전
```

따라서 솔버 호출 순서가 중요하다.

```text
1) δx, δy 로 장주 확대                 -> Mux*, Muy*
2) 축별 최소모멘트 하한 처리            -> Mux,check, Muy,check    ★ 여기까지가 수요 확정
3) α_e = atan2(Mux,check, Muy,check)   <- 반드시 하한 처리 후에 계산
4) 곡면 역해석
```

강도설계법 경로에서는 2)를 건너뛰므로 이 이슈가 없다.

### 1.7.4 입력 UI 분기

| 설계법 | `e_min` 입력 | 축력 상한 |
|---|---|---|
| `kds_strength` | **비활성화**(사용 안 함) | `α_limit` = 횡철근 형태에서 자동(0.80/0.85) |
| `bridge_lsd` | `e0x`, `e0y` (기본값 `max(h/30, 20)`, 오버라이드 가능) | 없음 |

현행 단일 `minEccentricity: number` 필드는 `bridge_lsd` 전용 `{ e0x, e0y }` 로 이전한다.

## 1.8 코드 간이법 (검증·대조용)

정확 곡면을 구현하더라도, 실무 보고서에서는 아래 간이법과의 대조를 요구받는 경우가 많다. **결과 대조 표시용으로 함께 구현**할 가치가 있다.

### (a) Bresler 역수법 (reciprocal load)

```text
1/Pn ≈ 1/Pnx + 1/Pny - 1/P0
```

`Pn ≥ 0.1·fck·Ag` 인 압축지배 영역에서만 유효. 저축력 구간에서 크게 틀림.

### (b) Bresler/PCA 하중등고선법 (load contour)

```text
(Mnx/Mnx0)^α + (Mny/Mny0)^α ≤ 1.0,   α ≈ 1.15 ~ 1.55
```

### (c) Eurocode 2 §5.8.9 지수법

```text
(MEdx/MRdx)^a + (MEdy/MRdy)^a ≤ 1.0

직사각형:  NEd/NRd = 0.1 → a=1.0
                     0.7 → a=1.5
                     1.0 → a=2.0   (선형보간)
원형/타원: a = 2.0
NRd = Ac·fcd + As·fyd
```

`bridge_lsd`(한계상태설계법) 모드의 간이 검토 옵션으로 잘 맞는다.

## 1.9 장주효과 — 현행 hypot 합성의 문제

현행 `expandedDemandMoment`:

```ts
return Math.hypot(mux, muy);   // ← 스칼라로 합성
```

`δx`, `δy`를 각각 곱한 뒤 **크기만 합성**해서 1축 곡선과 비교하고 있다. 이는 1축 엔진밖에 없던 시절의 임시방편이고, 2축에서는 자연스럽게 해소된다.

```text
Mux* = (Mux,ns + Mux,s)·δx
Muy* = (Muy,ns + Muy,s)·δy
→ 벡터 (Mux*, Muy*) 를 그대로 곡면에 던진다.
```

`δx ≠ δy` 이면 확대 후 편심 방향이 **회전**한다. 현행 보고서의 `theta_rot` 출력은 이미 그 방향을 계산하고 있지만 강도 계산에 쓰이지 않고 있다.

## 1.10 수치해석 이슈

### (1) 오목 단면

`clipPolygonAboveY`는 Sutherland–Hodgman 방식이다. 오목 다각형을 볼록 영역(반평면)으로 자르면 결과에 **폭 0의 퇴화 연결변**이 생기지만, 신발끈 공식으로 면적·도심을 구하면 그 기여가 0이므로 **결과는 정확하다**. 그대로 써도 된다.

### (1b) 중공 단면 — 부호 있는 다중 링 [확정 지원]

교각 실무를 겨냥해 **중공 단면을 정식 지원**한다. 현행 `SectionModel.polygon: Point[]` 단일 링으로는 표현 불가.

```ts
export type RingKind = "outer" | "hole";
export interface Ring { id: string; kind: RingKind; points: Point[] }
export interface SectionModel { rings: Ring[]; rebars: Rebar[] }
```

**정규화 규약**: 내부 저장 시 `outer`는 CCW(양의 부호면적), `hole`은 CW(음의 부호면적)로 강제한다. 그러면 모든 적분이 단순 합산이 된다.

```text
A       = Σ_rings  signedArea(ring)
first moment = Σ_rings  signedFirstMoment(ring)
centroid = Σ 1차모멘트 / Σ 면적
```

**핵심 성질 — 반평면 절단이 링별 독립으로 성립한다.**

압축영역을 `O`(외곽), `H`(중공), `HP`(반평면)라 하면

```text
압축영역 = (O ∩ HP) \ (H ∩ HP)
면적     = area(O ∩ HP) - area(H ∩ HP)
```

Sutherland–Hodgman은 **정점 순서를 보존**하므로 CW인 `H`를 자른 결과도 CW로 남는다. 즉 각 링을 독립적으로 자르고 부호면적을 합산하면 위 식이 자동으로 성립한다. **홀 전용 로직이 따로 필요 없다.** 파이버 적분의 밴드 절단(`clipBand`)도 동일하게 링별 독립 적용된다.

**주의 지점**

| 항목 | 처리 |
|---|---|
| `bounds` / `projectionRange` | **outer 링만** 사용 (hole은 내부에 있으므로) |
| `s_max`, `s_min`, `h_θ` | outer 링 기준 |
| `plasticCentroid` | 순 콘크리트 면적 `Ac`(홀 공제)로 계산 → 자동으로 맞음 |
| `Pn0`의 `Ag` | 순 면적(홀 공제). 현행 `Math.abs(polygonArea(...))`는 **abs 때문에 홀 부호가 죽으므로 반드시 제거** |
| SVG 렌더링 | 서브패스 + `fill-rule="evenodd"` |
| 입력 검증 | hole이 outer 내부에 있는지, 링 자기교차 여부 → **경고만 표시하고 크래시 금지** |
| 중공 벽 안의 철근 | 홀 내부에 찍힌 철근은 경고 (계산에서 제외하지는 않음 — 사용자 판단) |

**중공 단면이 2축에서 특히 중요한 이유**: 중공 사각형 교각을 대각선 방향으로 자르면 압축영역이 **분리된 두 조각**이 될 수 있다. 위 부호면적 방식은 이 경우도 자동으로 맞게 처리하지만, 도심이 실제 콘크리트가 없는 홀 한가운데에 놓일 수 있으므로 **도심 시각화 시 오해하지 않도록** 압축영역 음영을 반드시 함께 그린다.

### (2) `c` 탐색 (inner loop)

고정 `θ`에서 `Pn(c)`는 **단조 증가**한다 → 이분법이 항상 수렴. 안전.

### (3) `θ` 탐색 (outer loop)

`α_e(θ)`는 대칭 단면에서 단조 증가지만, **비대칭 배근/L형 단면에서는 비단조**일 수 있다.

```text
권장: θ ∈ [0, 2π) 를 굵은 격자(예: 1°)로 훑어 α_e 테이블을 만들고,
      목표 α_e 를 감싸는 모든 구간을 찾은 뒤
      각각 이분법으로 정밀화 → 그중 가장 큰 강도(바깥쪽 해)를 채택
```

### (4) 고축력 방향 특이성

`Pn → P0` 근처에서 `Mnx, Mny → 0`이므로 `α_e = atan2(Mnx, Mny)`가 수치적으로 불안정하다. `|M| < tol` 이면 방향 탐색을 건너뛰고 축력만 판정.

### (5) θ 범위와 대칭성

- 완전 비대칭 단면: `θ ∈ [0°, 360°)` 전부 필요.
- 2회 대칭(점대칭): `θ ∈ [0°, 180°)` + 부호 반전.
- 4회 대칭(정사각+대칭배근): `θ ∈ [0°, 90°)` + 미러링.

초기 구현은 **무조건 360° 전탐색**(비용이 무시할 수준)으로 가고, 대칭 감지는 최적화 단계로 미룬다.

### (6) 연산량

```text
격자 = nθ × nc = 72 × 60 = 4,320 회 단면적분
1회 ≈ (다각형 절점 + 철근 수) ≈ 150 연산
총 ≈ 65만 연산 → JS에서 수 ms
```

엔진 B(파이버, 50밴드)를 쓰면 50배 → 약 3천만 연산, 수백 ms. **엔진 B는 표시용 격자를 성기게(nθ=36) 하거나 Web Worker로** 넘기면 된다. 초기에는 워커 없이 시작해도 무방.

---

# Part 2. 현행 코드 갭 분석

## 2.1 반드시 교체되는 부분

| 위치 | 현행 | 2축 요구사항 |
|---|---|---|
| `geometry.ts: clipPolygonAboveY` | y 반평면 고정 | `clipHalfPlane(pts, nx, ny, sLimit)` 로 일반화 |
| `pm.ts: computePM` | `c` 1중 루프 | `(θ, c)` 2중 루프 → 곡면 |
| `pm.ts` 모멘트 | `mn` 단일 | `mnx`, `mny` |
| `pm.ts: referenceY` | 콘크리트 도심 | **소성중심 `(x_pc, y_pc)`** |
| `pm.ts: height` | `maxY - minY` | `h_θ = s_max - s_min` (θ 의존) |
| `types.ts: PMPoint` | `pn, mn, pd, md` | `+ theta, mnx, mny, mdx, mdy` |
| `types.ts: SectionModel` | `polygon: Point[]` | `rings: Ring[]` (**중공 지원 확정**) |
| `types.ts: PMOptions.minEccentricity` | 단일 스칼라 | `bridge_lsd` 전용 `{ e0x, e0y }`, `kds_strength`는 미사용 |
| `geometry.ts: polygonArea/centroid` | 단일 링 | 링 부호합산 (`Math.abs` 전면 제거) |
| `App.tsx: PMSvg` | M-P 2D 차트 | Mx-My 등고선 + 방향 슬라이스 |
| `App.tsx: checkDemand` | P 수평선 교점 | 곡면 역해석 (θ, c) |
| `App.tsx: expandedDemandMoment` | `hypot(Mux, Muy)` | 벡터 `(Mux*, Muy*)` 유지 |
| `App.tsx: minimumEccentricityCutoff` | 축력·최소모멘트 하이브리드 | 설계법 분기: 축력 cutoff / 최소모멘트 |
| `App.tsx: CoordinateTable` | 절점 1개 테이블 | 링 단위 테이블 + 링 추가/삭제/종류 |
| `App.tsx: SectionSvg` | 단일 `<polygon>` | 서브패스 `<path fill-rule="evenodd">` |

**`Math.abs` 감사 항목** — 중공 지원 시 부호를 죽이면 홀이 무시된다. 아래 지점을 모두 점검한다.

```text
pm.ts:29   Math.abs(polygonArea(compressed))
pm.ts:93   Math.abs(polygonArea(polygon))
App.tsx:895 Math.abs(polygonArea(compressed))
App.tsx:964 Math.abs(polygonArea(compressed))
App.tsx:1261 Math.abs(polygonArea(polygon))
App.tsx:135  Math.abs(polygonArea(polygon))
geometry.ts:61-63  secondMoments 의 ix/iy/ixy 절대값
```

정규화(outer CCW / hole CW)를 강제하면 `abs`가 전부 불필요해진다.

## 2.2 중복 코드 — 선행 정리 필요 (블로커)

단면 적분 로직이 **3곳에 복붙**되어 있다.

- `pm.ts: computePM` (22~66행)
- `App.tsx: computeBalancedState` (875~946행)
- `App.tsx: computeSectionComponentsAtC` (948~1011행)

2축으로 가면 각각이 `θ` 루프까지 떠안게 되어 유지보수가 붕괴한다.
→ **Phase 1에서 단일 프리미티브로 추출하는 것이 선결 조건이다.**

또한 `phi` 로직도 3중복이다: `designCodes.kds_strength.phi` → `pm.ts: adjustedPhi` 가 덮어씀 → `App.tsx: strengthReductionPhi` 가 또 있음. 사실상 `designCodes.phi`는 죽은 코드.

## 2.3 함께 고칠 기존 결함

1. **`geometry.ts:63` — `ixy: Math.abs(...)`**
   단면상승모멘트 `Ixy`는 **부호가 의미를 갖는다**. 절대값을 씌우면 주축(principal axis) 계산이 불가능하다. 현재는 대칭단면이라 `Ixy=0`이어서 드러나지 않았지만, 2축 장주검토에서 주축 세장비를 쓰려면 반드시 부호를 살려야 한다.

2. **`computePureCompression`의 `mn ≠ 0`**
   도심 기준이라 비대칭 배근에서 순압축 모멘트가 0이 아니다. 소성중심 도입으로 자동 해소.

3. **`bounds()`의 `Math.min(...xs)` 스프레드**
   절점 수가 많아지면 스택 한계. 2축에서 원형 분할 수를 올릴 수 있으므로 루프로 교체 권장.

4. **테스트 인프라 부재** — `package.json`에 test 스크립트 없음. 2축은 눈으로 검증이 불가능하므로 **vitest 도입이 필수**.

---

# Part 3. 구현 계획

## Phase 0 — 테스트 기반 마련 (0.5일)

- `vitest` 추가, `npm test` 스크립트.
- **현행 1축 결과를 골든 스냅샷으로 고정**: 기본 400×600 예제와 B5-I 예제의 `computePM` 출력 전체를 JSON으로 저장.
- 이후 모든 리팩터링은 이 스냅샷을 깨지 않아야 한다.

산출물: `src/engine/__tests__/uniaxial.golden.test.ts`, `fixtures/*.json`

## Phase 1 — 단면 적분 프리미티브 추출 (1일) **[블로커]**

기능 변화 0. 순수 리팩터링.

```ts
// src/engine/section.ts  (신규)
export interface StrainState { theta: number; c: number }

export interface SectionResponse {
  pn: number; mnx: number; mny: number;
  phi: number;
  pd: number; mdx: number; mdy: number;
  maxTensileStrain: number;
  concrete: { force: number; mx: number; my: number; area: number; centroid: Point };
  bars: Array<{ id: string; strain: number; stress: number; force: number }>;
  neutralAxis: { theta: number; c: number; sMax: number; depth: number };
}

export function sectionResponse(
  section: SectionModel,
  materials: MaterialSet,
  code: DesignCodeStrategy,
  state: StrainState,
  opts: IntegrationOptions,
): SectionResponse
```

- `θ` 인자는 받되 이 단계에서는 항상 `π/2`로 호출 → 결과 동일.
- `computePM`, `computeBalancedState`, `computeSectionComponentsAtC` 3곳을 모두 이 함수 호출로 치환.
- `phi` 계산을 `designCodes.ts` 한 곳으로 통합, `adjustedPhi`/`strengthReductionPhi` 제거.

**검증**: Phase 0 골든 스냅샷 무변화.

## Phase 2 — 다중 링(중공단면) 도입 (1.5일)

기하 모델을 링 집합으로 바꾼다. **1축 상태에서 먼저 완료**해야 2축 디버깅과 섞이지 않는다.

```ts
// types.ts
export type RingKind = "outer" | "hole";
export interface Ring { id: string; kind: RingKind; points: Point[] }
export interface SectionModel { rings: Ring[]; rebars: Rebar[] }

// geometry.ts
export function normalizeRings(rings: Ring[]): Ring[]        // outer=CCW, hole=CW 강제
export function sectionArea(rings: Ring[]): number           // 부호합산, abs 없음
export function sectionCentroid(rings: Ring[]): Point
export function sectionSecondMoments(rings: Ring[]): { ix; iy; ixy }   // ixy 부호 보존
export function outerBounds(rings: Ring[]): Bounds           // outer 링만
```

작업 항목:

- `Math.abs(polygonArea(...))` 7개소 전부 제거(§2.1 감사표).
- `secondMoments`의 `ixy` 절대값 제거 + `principalAxes()` 추가.
- `bounds()`의 `Math.min(...xs)` 스프레드 → 루프.
- 클리핑을 링 배열 단위로 처리하는 래퍼 추가.
- 생성기 확장: 중공 사각형(벽두께 `t`), 중공 원형(내경 `Di`).
- UI: 링 단위 절점 테이블, 링 추가/삭제/종류 토글.
- `SectionSvg`: 서브패스 + `fill-rule="evenodd"`.
- 입력 검증: hole ⊄ outer, 자기교차 → **경고 배너만, 크래시 금지**.

**검증**
- 단일 outer 링만 있을 때 Phase 0 골든 스냅샷 무변화.
- 중공 사각형 `B×H`, 벽두께 `t` → `A = BH - (B-2t)(H-2t)` 해석해와 일치.
- 중공 원형의 `Ix = π(D⁴-Di⁴)/64` 해석해와 일치.
- 반평면으로 자른 중공 단면의 면적/도심을, 조밀 몬테카를로 샘플링 결과와 0.1% 이내 대조.

## Phase 3 — 임의 반평면 클리핑 + 소성중심 (1일)

```ts
// geometry.ts
export function clipHalfPlane(rings: Ring[], nx: number, ny: number, sLimit: number): Ring[]
export function clipBand(rings: Ring[], nx: number, ny: number, sLo: number, sHi: number): Ring[]
export function projectionRange(rings: Ring[], nx: number, ny: number): { sMin: number; sMax: number }
export function plasticCentroid(section, fcd, fyd, alphaBlock): Point
```

- `clipPolygonAboveY(p, y)` = `clipHalfPlane(rings, 0, 1, y)` 로 대체 후 구버전 제거.
- 모멘트 기준점을 `centroid(polygon)` → `plasticCentroid(...)` 로 교체.
- 보고서에 `x_pc, y_pc` 및 기하도심과의 차이 출력.

**검증**
- 임의 각도로 자른 뒤 좌표 역회전한 결과 == 회전 후 `clipPolygonAboveY` 결과 (property test, 무작위 100 케이스).
- 순압축점 `Mnx = Mny = 0` (비대칭 배근 포함).
- **주의**: 비대칭 배근 예제의 골든 `Mn`이 바뀐다. 의도된 변경이므로 스냅샷 갱신 + 사유 기록. 대칭 예제(기본 400×600, B5-I)는 **변화 없어야 한다** — 변하면 버그다.

## Phase 4 — 2축 곡면 생성 (2일) **[핵심]**

```ts
// src/engine/surface.ts (신규)
export interface SurfacePoint extends SectionResponse { theta: number; c: number; alphaE: number }
export interface InteractionSurface {
  thetas: number[];              // nθ
  meridians: SurfacePoint[][];   // [θ index][c index]
  p0: number;                    // 순압축
  pt: { pn: number; mnx: number; mny: number };  // 순인장
  axialCap: number;              // α_limit·φ·Pn0
}

export function computeSurface(section, materials, options): InteractionSurface
```

- `θ ∈ [0, 2π)` 를 `nθ`(기본 72) 분할, 각 `θ`에서 `c` sweep.
- `c` 범위는 `h_θ = sMax - sMin` 기준으로 스케일 (`0.02·h_θ ~ 1.8·h_θ` + 순압축/순인장 끝점).
- 각 점에 `α_e` 저장.
- 축력 상한 clamp 적용.

**검증 (불변식 테스트)**
| 테스트 | 기대 |
|---|---|
| 원형단면 | 임의 P 수평 절단면이 **정확한 원** (반경 편차 < 0.5%) |
| 대칭 사각형, θ=90° | Phase 0 골든 1축 곡선과 일치 |
| 대칭 사각형, θ=0° | 축 바꾼 1축 곡선과 일치 |
| 점대칭 단면 | `M(θ+180°) = -M(θ)` |
| 순압축점 | 모든 θ에서 동일한 `(P0, 0, 0)` |
| 볼록성 | 공칭곡면의 각 P-절단면이 볼록 (φ 곡면은 비볼록 허용) |

## Phase 5 — 역해석 솔버 (1.5일) **[핵심]**

```ts
// src/engine/solve.ts (신규)
/** 주어진 축력 Pu 와 편심방향 α_e 에서 곡면 위의 점을 찾는다 */
export function capacityAt(
  surface: InteractionSurface, section, materials, code,
  pu: number, alphaE: number,
): SurfacePoint | undefined

/** 하중케이스 사용률 */
export function utilization(
  ..., pu: number, mux: number, muy: number,
): { ratio: number; capacity: SurfacePoint; ok: boolean }
```

알고리즘:

```text
0) 수요 확정 (§1.7.3 순서 엄수)
     Mux*, Muy*  = 장주 확대 적용
     bridge_lsd  이면 축별 최소모멘트 하한 처리 -> Mux,chk, Muy,chk
     kds_strength 이면 하한 처리 없음 (Mux,chk = Mux*)
1) α_e = atan2(Mux,chk, Muy,chk)      <- 반드시 0) 이후
2) outer: θ 격자에서 α_e(θ) 테이블 (각 θ마다 inner 실행)
   inner: 이분법으로 Pn(θ,c) = Pu 인 c 를 찾음  (Pn은 c에 단조)
3) α_e(θ) - α_e,target 의 부호 변화 구간을 모두 수집
4) 각 구간을 이분법으로 정밀화 (tol: α_e 0.01°, P 0.01%)
5) 여러 해 중 |M| 최대인 것 채택
6) ratio = hypot(Mux,chk, Muy,chk) / hypot(Mdx, Mdy)
```

**예외 처리**
- `Pu > axialCap` (kds_strength) → 즉시 NG, ratio = ∞
- `Pu < 순인장 강도` → 즉시 NG
- `|Mu| < tol` → 축력만 판정
- 해 없음 → `undefined` 반환하고 보고서에 명시 (조용히 0 반환 금지)

**검증**
- 원형단면: 모든 α_e에서 동일한 강도.
- 대칭 사각형에서 `Muy=0` → Phase 0 1축 `checkDemand` 결과와 일치.
- 왕복 테스트: 곡면 위 점 하나를 골라 그 `(Pn, Mnx, Mny)`를 demand로 넣으면 `ratio ≈ 1.000`.

## Phase 6 — 최소편심 설계법 분기 (0.5일)

§1.7 확정안을 코드로 옮긴다. 곡면/솔버가 완성된 뒤에 붙여야 회귀 추적이 쉽다.

```ts
// designCodes.ts — 전략에 편입
export interface DesignCodeStrategy {
  // ...기존
  accidentalEccentricity:
    | { mode: "axial_cutoff" }                             // kds_strength
    | { mode: "minimum_moment"; e0: (h: number) => number } // bridge_lsd
}
```

- `kds_strength`: `computeSurface`에서 `axialCap = α_limit·φ·Pn0` 로 곡면 상단 절단. **수요는 손대지 않는다.**
- `bridge_lsd`: 곡면은 그대로. 검토 시 `Mux,chk = max(|Mux*|, NEd·e0y/1000)`, `Muy,chk = max(|Muy*|, NEd·e0x/1000)`. 기본값 `e0 = max(h/30, 20)`, 사용자 오버라이드 허용.
- `App.tsx: minimumEccentricityCutoff()` 하이브리드 로직 **제거**.
- 입력 UI: 설계법에 따라 `e_min` 필드 활성/비활성 전환.

**검증**
- `kds_strength`: 순압축 근처에서 `φPn`이 정확히 `α·φ·Pn0`로 잘리는지. 곡면이 수요와 무관한지(하중케이스를 바꿔도 곡면 불변).
- `bridge_lsd`: `Mux*=0, Muy*=0` 인 순압축 하중을 넣으면 `Mux,chk = NEd·e0y/1000`로 올라오고 NG/OK 판정이 바뀌는지.
- `Mux*=3000, Muy*=0` 케이스에서 하한 처리 후 `α_e`가 90°에서 이동하는지(§1.7.3 회귀 테스트).
- 두 설계법 간 전환 시 **곡면 자체는 재료계수 차이만큼만** 달라지는지.

## Phase 7 — 파이버 적분 엔진 (1일, 선택)

- `IntegrationOptions.method: "equivalent_block" | "fiber"`.
- KDS 포물선-직선 `σ(ε)` (`n`, `ε_co`, `ε_cu`는 fck 의존) 구현.
- EC2 §3.1.7(3) **테이퍼 압축영역 10% 저감** 토글 추가 (등가블록 모드용).
  - 판정: 압축영역의 폭이 최압축 연단 쪽으로 감소하는가 → 밴드 폭 배열의 단조성으로 자동 감지.
- 두 엔진 결과 차이를 보고서에 병기.

**검증**: 사각형 1축에서 두 엔진 차이 < 3%. 삼각형 압축영역(45° 모서리 압축)에서 차이가 유의하게 나타나는지 확인.

## Phase 8 — UI (2.5일)

### 8.1 차트 3종

| 차트 | 내용 | 우선순위 |
|---|---|---|
| **Mx-My 등고선** | 선택 P(또는 각 하중케이스 Pu)에서의 수평 절단. 하중점 함께 표시 | 필수 |
| **P-M 방향 슬라이스** | 선택 방향 α_e(기본: 하중케이스 방향)에서의 수직 절단. **현행 차트를 이걸로 승격** | 필수 |
| **3D 와이어프레임** | 아이소메트릭 곡면. `nθ` 자오선 + P 등고선 | 선택 |

### 8.2 단면 미리보기 확장

- 중립축을 임의 각도 직선으로 그리기 (현행은 수평선 고정).
- 압축영역 음영 — **중공 링 포함** `fill-rule="evenodd"` 서브패스.
- 소성중심 마커 + 기하도심 마커 동시 표시(§1.10 (1b) 오해 방지).
- 철근별 변형률 색상 (인장 청색 ↔ 압축 적색).

### 8.3 컨트롤

- `θ` 슬라이더 (0~360°), `c` 슬라이더 → 단면 미리보기 실시간 연동.
- 적분 방식 토글 (등가블록 / 파이버).
- 표시 토글: 공칭곡면 / 설계곡면 / Bresler / EC2 지수법.
- 하중케이스 선택 → 해당 Pu 등고선 + α_e 슬라이스 자동 이동.

### 8.4 입력

- **링 편집기**: 링 목록 + 종류(외곽/중공) + 링별 절점 테이블. 중공 사각형/원형 생성기(벽두께 `t`, 내경 `Di`).
- `DemandPoint`: 이미 `muxNs, muxS, muy` 존재. **`muyNs, muyS` 로 분리**하고 `mu` 스칼라 필드는 제거(또는 파생값으로).
- 최소편심: `bridge_lsd`일 때만 `e0x`, `e0y` 노출. `kds_strength`에서는 비활성 + "축력 상한으로 대체됨" 안내.

### 8.5 [확정] 1축 전용 경로 제거 — 완전 통합

별도 1축 모드를 두지 않는다. `Muy = 0`이면 결과가 자동으로 1축과 같아진다.

- `pm.ts: computePM`은 삭제하거나 `computeSurface(...).meridians[θ=90°]` 를 반환하는 **얇은 호환 래퍼**로만 남긴다.
- 기존 P-M 차트는 "방향 슬라이스" 차트로 승격하되, 기본 선택 방향을 `α_e = 90°`로 두어 **기존 사용자에게 화면이 그대로 보이게** 한다.
- 코드 경로가 하나여야 §Part 4의 불변식 테스트가 실제 사용 경로를 검증한다.

## Phase 9 — 보고서 확장 (1일)

하중케이스별 출력 항목:

```text
① 작용하중       Pu, Mux.ns/s, Muy.ns/s, βdx, βdy
② 장주효과       λx, λy, Pcx, Pcy, δx, δy -> Mux*, Muy*
③ 우발편심 처리  [kds_strength]  축력 상한 α·φ·Pn0 = ___ kN  (최소모멘트 미적용)
                 [bridge_lsd]    e0x, e0y / Mux,chk, Muy,chk / 하한 적용 여부
④ 편심           ex = Muy,chk/Pu, ey = Mux,chk/Pu, |e|, α_e
⑤ 중립축 해      θ (수렴값), c, h_θ, 반복 횟수
                 ★ θ vs α_e 차이 = 2축 효과의 크기
⑥ 단면력 분해    Cc, Cs, Tt / Mcx,Mcy, Msx,Msy, Mtx,Mty
⑦ 변형률         ε_t (최외단 인장철근 ID 명시), ε_y, 지배단면 판정
⑧ 강도           φ, φPn, φMnx, φMny
⑨ 판정           사용률 = |Mu,chk| / |φMn|,  O.K / N.G
⑩ 간이법 대조    Bresler 역수법, EC2 §5.8.9 지수법 결과 병기
```

단면 제원부에는 **링별 면적**(외곽 / 중공 / 순단면)과 소성중심 좌표를 추가한다.
기존 1축 보고서 포맷(들여쓰기·정렬)을 유지하여 실무 연속성을 보장한다.

## 3.1 일정 요약

```text
Phase 0  테스트 기반                 0.5일
Phase 1  프리미티브 추출 [블로커]      1.0일
Phase 2  다중 링(중공단면)            1.5일
Phase 3  반평면 클리핑 + 소성중심      1.0일
Phase 4  곡면 생성 [핵심]             2.0일
Phase 5  역해석 솔버 [핵심]           1.5일
Phase 6  최소편심 설계법 분기          0.5일
Phase 7  파이버 적분 (선택)           1.0일
Phase 8  UI                         2.5일
Phase 9  보고서                      1.0일
                              합계  12.5일
```

Phase 0~6까지가 **엔진 완성**(7.5일). Phase 7(파이버)은 뒤로 미뤄도 무방.

**의존 관계**

```text
0 -> 1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 8 -> 9
                    └-> 7 (선택, 4 이후 언제든)
```

Phase 2(중공)를 2축(Phase 4)보다 먼저 두는 이유: 링 부호 버그와 θ 회전 버그가 동시에 터지면 원인 분리가 불가능하다. **1축 상태에서 중공을 완전히 검증**한 뒤 각도를 도입한다.

---

# Part 4. 검증 전략 요약

2축은 손계산 검증이 사실상 불가능하므로 **불변식(invariant) 테스트**가 주 무기다.

| # | 불변식 | 왜 강력한가 |
|---|---|---|
| 1 | 원형단면 곡면은 축대칭 | θ 루프·클리핑·모멘트 부호를 한 번에 검증 |
| 2 | θ=90° 슬라이스 == 기존 1축 골든 | 회귀 방지 |
| 3 | 점대칭 단면: `M(θ+180°) = -M(θ)` | 부호 규약 검증 |
| 4 | 곡면 점을 demand로 넣으면 ratio=1 | 솔버 왕복 검증 |
| 5 | 순압축점이 모든 θ에서 (P0,0,0) | 소성중심 검증 |
| 6 | 공칭 P-절단면의 볼록성 | 적분/클리핑 오류 탐지 |
| 7 | 고축력 구간에서 Bresler 역수법과 5% 이내 | 물리적 타당성 |
| 8 | 밴드 수 N을 2배로 늘려도 결과 변화 < 0.1% | 파이버 적분 수렴성 |
| 9 | 중공 사각/원형의 A, Ix, Iy가 해석해와 일치 | 링 부호 규약 검증 |
| 10 | 반평면으로 자른 중공 단면 == 몬테카를로 샘플링 (0.1%) | 클리핑×홀 상호작용 검증 |
| 11 | `kds_strength`에서 곡면이 하중케이스에 불변 | 축력 cutoff가 수요를 오염시키지 않음 |
| 12 | `bridge_lsd`에서 하한 처리 후 α_e 이동 | §1.7.3 함정 회귀 방지 |

추가로, 가능하면 **B5-I 예제의 2축 하중케이스 실제 자료**(Muy ≠ 0)를 확보해 상용 프로그램 결과와 대조하는 것이 가장 확실하다.

---

# Part 5. 확정 사항 및 잔여 결정

## 5.1 확정 (2026-08-04)

| # | 항목 | 결정 | 반영 위치 |
|---|---|---|---|
| 1 | 중공 단면 지원 | **정식 지원**. `SectionModel.rings: Ring[]`, outer=CCW / hole=CW 부호합산 | §1.10(1b), Phase 2 |
| 2 | 1축/2축 통합 | **완전 통합**. 1축 전용 경로 제거, `Muy=0`이면 자동 동일 | §Phase 8.5 |
| 3 | 최소편심 — 강도설계법 | **축력 cutoff** `φPn ≤ α·φ·Pn0`. 최소모멘트 미적용 | §1.7.1, Phase 6 |
| 4 | 최소편심 — 한계상태설계법 | **최소모멘트 검토**. 곡면 불변, 수요를 축별 하한 처리 | §1.7.2, Phase 6 |

3·4의 귀결로 **강도곡면 생성 로직이 설계법에 따라 달라지는 지점은 `axialCap` 하나뿐**이 된다. `bridge_lsd`의 우발편심은 전적으로 검토 단계에서만 개입하므로, 곡면 코드가 단순해지고 테스트도 쉬워진다.

## 5.2 잔여 결정 (착수 후 판단 가능)

1. **기본 적분 방식** — 등가블록(빠름·관행) vs 파이버(정확).
   → 등가블록 기본 + EC2 §3.1.7(3) 10% 저감 토글, 파이버는 검증 모드. Phase 7에서 실측 후 확정.

2. **`bridge_lsd`의 EC2 §5.8.9 지수법 지위** — 정식 검토 수단 vs 참고 표시.
   → 우선 참고 표시로 구현하고, 정확 곡면과의 차이를 실제 단면에서 본 뒤 판단.

3. **중공 단면의 철근 배치 생성기** — 벽 중앙 1열 vs 내·외측 2열.
   → 교각 실무는 내·외측 2열이 일반적. Phase 2 UI 작업 시 구체화.

4. **θ 격자 해상도** — 표시용 nθ 기본값(72 제안)과 솔버 탐색 격자(1° 제안)의 분리 여부.

---

# 참고자료

- StructurePoint, *Manual Design Procedure for Columns with Biaxial Bending (ACI 318-11/14/19)* — 중립축 각도 반복 결정 절차
  https://structurepoint.org/publication/pdf/Designing-Columns-for-Biaxial-Bending-using-Manual-Design-Procedure.pdf
- StructurePoint, *Biaxial Bending Interaction Diagrams for Rectangular RC Column Design (ACI 318-19)*
  https://structurepoint.org/publication/pdf/Biaxial-Bending-Interaction-Diagrams-for-Rectangular-Reinforced-Concrete-Column-Design-ACI-318-19.pdf
- KDS 14 20 20 콘크리트구조 휨 및 압축 설계기준 — 2축 휨 압축부재, 소성중심 기준 편심
  https://www.kcsc.re.kr/standardCode/list/101014
- KDS 24 14 21 콘크리트교 설계기준(한계상태설계법)
  https://www.law.go.kr/LSW/admRulLsInfoP.do?admRulSeq=2100000250496
- Eurocode 2 §3.1.7(3) 테이퍼 압축영역 η·fcd 10% 저감
  https://usingeurocodes.com/en/eurocode-2-1-1/Materials/rectangular-stress-distribution-concrete
- Eurocode 2 §5.8.9 2축 휨 지수법 (a = 1.0/1.5/2.0)
  https://www.concretecentre.com/TCC/media/TCCMediaLibrary/PDF%20attachments/Lecture-7-Columns-PHG-B2-Rev-4-2Nov17.pdf
- 등가응력블록의 등가화 원리 (기존 문서 `compression-steel-stress-block-review.md` 참조)

---

# Part 6. 구현 결과 및 계획 대비 차이 (2026-08-04)

## 6.1 최종 모듈 구성

```text
src/engine/
  types.ts        Ring / SectionModel(rings) / 재료 / 옵션
  geometry.ts     부호 링 기하: normalizeRings, sectionArea/Centroid/SecondMoments,
                  clipHalfPlane, clipRingsHalfPlane, clipRingsBand, principalAxes, validateRings
  concreteLaw.ts  포물선-직선 σ(ε)
  designCodes.ts  설계법 전략 (stressBlock, phi, axialLimitFactor)
  section.ts      ★ sectionResponse() 단일 프리미티브 + plasticCentroid + 등가블록/파이버 적분
  surface.ts      computeSurface() (θ, c) 곡면, momentContour, interpolateAtAxial
  solve.ts        capacityAt() 역해석 (outer θ / inner c)
  demand.ts       prepareDemand() 장주확대 + 설계법별 우발편심, checkDemand() 사용률
  simplified.ts   Bresler 역수법, EC2 5.8.9 지수법
  pm.ts           1축 호환 래퍼 (= θ=π/2 자오선)
src/report.ts     2축 검토보고서
src/App.tsx       링 편집기 + 단면뷰 + Mx-My 등고선 + P-M 방향 슬라이스
```

테스트 105개 / 10파일. 골든 3종(1축 P-M, 보고서 2설계법).

## 6.2 구현 중 발견한 사항

### (1) [실제 결함] 축력 상한이 설계축력을 역해석 불가능하게 만든다

계획 §1.7.1 대로 `φPn ≤ α·φ·Pn0` 를 clamp 했더니, 깊은 중립축 구간에서 `pd(c)` 가
**평탄면**이 되었다(예: c ≥ 1009mm 에서 전부 8542 kN). 이분법이 평탄면 위를 헤매다
c = 21588mm(사실상 순압축, 모멘트 ≈ 0)로 발산해 검토가 실패했다.

**해결**: 역해석은 상한 **미적용** 값 `pdRaw = φPn` 으로 c 를 찾고, 상한은 결과 보고
단계에서만 clamp 한다. 그렇게 찾은 점이 곧 "절단면 P = cap 위에서 모멘트가 최대인 점"이다.
`SurfacePoint.pdRaw` 필드가 이 목적으로 추가되었다.

### (2) [모델링 오류] 잘린 점의 모멘트를 비례축소하면 안 된다

처음엔 capped 점의 모멘트를 `axialCap / pd` 로 축소했는데, 이는 **원래 곡면에 없던 점을
지어내는 것**이다. 축력 상한은 곡면을 평면으로 **자르는** 것이지 원점 방향으로 당기는 것이
아니다. 축력만 clamp 하고 모멘트는 그대로 두면, 더 깊은 c 는 모멘트가 작아 자동으로
열등해지므로 "최대 모멘트 해 채택" 규칙만으로 올바른 절단면이 나온다.

### (3) [모델링 오류] 파이버 법칙의 정점응력

포물선-직선 법칙의 정점을 `fcd` 로 두었더니 등가블록과 정확히 `1/0.85 = 17.6%` 어긋났다.
`0.85` 는 지속하중/치수효과 보정이며 **응력법칙의 형상과 무관하게** 적용되므로,
파이버 정점응력도 `α·fcd` 여야 한다. 수정 후 두 엔진 차이는 1축 직사각형에서 5% 이내다.

### (4) [계획대로 아님] 원형 단면 축대칭 오차는 철근 이산화

"원형 곡면은 축대칭" 불변식이 16본 배근에서 국소 상대오차 9.4% 로 실패했다.
진단 결과 엔진 버그가 아니라 **철근 이산화**였다(`maxΔP/Pn0` 가 8본 0.78% → 16본 0.30%
→ 32본 0.17% → 64본 0.001% 로 단조 수렴). 테스트를 국소 상대오차가 아니라 `Pn0` 기준
절대오차로 정규화하고, **수렴성 자체를 별도 테스트로 승격**했다.

### (5) [계획대로] EC2 지수법은 저축력에서 보수적이다

정확 곡면 위의 점을 EC2 §5.8.9 에 넣으면 사용률이 1.39 가 나온다. 저축력에서 `a → 1.0` 은
직선 상관식이고 실제 등고선은 볼록하므로 직선이 안쪽에 놓이기 때문이다. 즉 **정상**이며,
테스트도 "1에 가깝다"가 아니라 "보수측(>1)이고 2배 이내"로 기술했다.

### (6) 성능

계획의 추정(수 ms)보다는 크지만 실용 범위다.

```text
중공 교각 3000x4000x400, 32본, 72θ x 60c
  computeSurface   148 ms
  checkDemand       12 ms   (자오선 재사용 coarse 패스 덕분)
  buildReport       43 ms
```

`capacityAt` 의 coarse 패스를 **사전계산된 자오선 재사용**으로 바꾼 것이 결정적이었다
(추가 단면적분 0회). 초기 구현은 θ 마다 96표본을 다시 적분해 원형 단면에서 30초가 걸렸다.

### (7) 계획에서 빠졌던 UI 이슈

- 중립축 선을 `s·n̂` 기준으로 그리면 c 가 클 때 화면 밖 먼 곳에서 시작해 불필요하게
  긴 파선을 래스터화한다. **화면 중심을 직선 위로 투영한 점** 기준으로 ±(대각선/2) 만 그린다.
- 공칭곡선을 함께 표시할 때 축 범위에 공칭값을 포함하지 않으면 차트 밖으로 벗어난다.
- 축력 cutoff 주석선은 설계곡선이 상한에 닿는 지점까지만 그려야 한다.
  전 폭으로 그으면 존재하지 않는 강도가 있는 것처럼 보인다.

## 6.3 검증된 불변식 (전부 통과)

| # | 불변식 | 결과 |
|---|---|---|
| 1 | 원형 단면 곡면 축대칭 | 등고선 반경 편차 < 3%, 철근 수에 따라 수렴 |
| 2 | θ=90° 자오선 == 1축 골든 | 1e-9 일치 |
| 3 | θ=0° 자오선 == 축 바꾼 1축 | 1e-9 일치 |
| 4 | 점대칭 단면 M(θ+180°) = -M(θ) | 1e-9 일치 |
| 5 | 순압축점이 모든 θ 에서 (P0, 0, 0) | 비대칭 배근 포함 1e-12 |
| 6 | 공칭 등고선의 볼록성 | P/Pn0 = 0.1 ~ 0.7 전부 볼록 |
| 7 | 곡면 위 점 -> ratio = 1 (왕복) | 20+ 점에서 2e-3 이내 |
| 8 | 파이버 밴드 2배 -> 변화 < 0.1% | 통과 |
| 9 | 중공 사각/원형 A, Ix, Iy 해석해 | 통과 |
| 10 | 반평면 절단 x 중공 == 격자 샘플링 | 5각도 전부 0.2% 이내 |
| 11 | kds_strength 곡면이 하중케이스에 불변 | 통과 |
| 12 | bridge_lsd 하한 처리 후 α_e 회전 | 90.0° -> 82.4° 확인 |
| 13 | **α_e ≠ θ** (2축 효과의 실재) | 세장 단면 > 10°, 원형 < 3° |

실제 UI 확인 결과 400x600 / Pu=1000kN / Mux=120, Muy=60 케이스에서
**α_e = 63.07°, θ = 38.70° (24.4° 이격)** 으로, 2축 효과가 계산에 실제로 반영되고 있다.

## 6.4 남은 과제

- B5-I 예제의 **2축 하중케이스 실제 자료**(Muy ≠ 0)를 확보해 상용 프로그램과 대조.
  현재 골든은 자체 불변식 기반이므로 외부 검증이 추가되면 신뢰도가 올라간다.
- 3D 와이어프레임 곡면 뷰(계획상 "선택").
- θ 대칭 감지로 격자 축소(성능 최적화, 현재는 무조건 360° 전탐색).
- 중공 단면 전용 배근 생성기 UI (엔진에는 `generateHollowRectangleRebars` /
  `generateHollowCircleRebars` 가 이미 있으나 화면에 노출하지 않았다).
