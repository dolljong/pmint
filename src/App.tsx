import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { Circle, FileText, Grid2X2, Plus, RotateCcw, Trash2 } from "lucide-react";
import {
  axisNormal,
  circleRings,
  clipRingsHalfPlane,
  makeRing,
  outerBounds,
  rectanglePolygon,
  rectangleRings,
  sectionArea,
  sectionCentroid,
  sectionProjectionRange,
  sectionSecondMoments,
  signedArea,
  validateRings,
} from "./engine/geometry";
import { generateCircleRebars, generateRectangleRebars, type RectRebarLayer } from "./engine/rebarLayout";
import { computeSurface, meridianAtTheta, momentContour, type InteractionSurface } from "./engine/surface";
import { checkDemand, type ColumnGeometry, type DemandCheck, type DemandInput } from "./engine/demand";
import { designCodes } from "./engine/designCodes";
import type {
  DesignCodeId,
  IntegrationMethod,
  MaterialSet,
  Point,
  Rebar,
  Ring,
  ShapeMode,
  TransverseReinforcement,
} from "./engine/types";
import { buildReport, fmt, radToDeg, sci, type ReportColumn } from "./report";

interface ColumnCondition extends ColumnGeometry {
  title: string;
  cover: number;
  tieType: string;
}

const defaultRings = rectangleRings(400, 600);
const defaultRebars: Rebar[] = [
  { id: "R1", x: -150, y: -250, diameter: 25 },
  { id: "R2", x: 150, y: -250, diameter: 25 },
  { id: "R3", x: -150, y: 250, diameter: 25 },
  { id: "R4", x: 150, y: 250, diameter: 25 },
];
const defaultMaterials: MaterialSet = {
  concrete: { fc: 30, ecu: 0.0033 },
  steel: { fy: 400, es: 200000 },
};
const defaultDemands: DemandInput[] = [
  { id: "D1", label: "LC1", pu: 1000, muxNs: 120, muxS: 0, muyNs: 60, muyS: 0, betaDx: 0, betaDy: 0 },
];
const defaultRectRebarLayers: RectRebarLayer[] = [
  { id: "L1", dc: 62.5, diameter: 25, top: 2, right: 2, bottom: 2, left: 2 },
];
const defaultColumnCondition: ColumnCondition = {
  title: "RC 기둥",
  cover: 50,
  lu: 3000,
  kx: 1,
  ky: 1,
  tieType: "띠 철근",
};

const b5iRectRebarLayers: RectRebarLayer[] = [
  { id: "L1", dc: 90, diameter: 32, top: 10, right: 10, bottom: 10, left: 10 },
  { id: "L2", dc: 120, diameter: 32, top: 10, right: 10, bottom: 10, left: 10 },
];
const b5iMaterials: MaterialSet = {
  concrete: { fc: 80, ecu: 0.003, ec: 37490 },
  steel: { fy: 600, es: 200000 },
};
const b5iDemands: DemandInput[] = [
  { id: "D1", label: "Load Case 1", pu: 42907, muxNs: 3493, muxS: 0, muyNs: 0, muyS: 0, betaDx: 0, betaDy: 0 },
  { id: "D2", label: "Load Case 2", pu: 55092.1, muxNs: 1524.5, muxS: 0, muyNs: 0, muyS: 0, betaDx: 0, betaDy: 0 },
];
const b5iColumnCondition: ColumnCondition = {
  title: "B5-I",
  cover: 105,
  lu: 7079,
  kx: 1,
  ky: 1,
  tieType: "띠 철근",
};

const hollowPierRebarLayers: RectRebarLayer[] = [
  { id: "L1", dc: 100, diameter: 32, top: 8, right: 10, bottom: 8, left: 10 },
];

export default function App() {
  const [shapeMode, setShapeMode] = useState<ShapeMode>("rectangle");
  const [rings, setRings] = useState<Ring[]>(defaultRings);
  const [rebars, setRebars] = useState<Rebar[]>(defaultRebars);
  const [materials, setMaterials] = useState<MaterialSet>(defaultMaterials);
  const [designCode, setDesignCode] = useState<DesignCodeId>("kds_strength");
  const [rect, setRect] = useState({ width: 400, height: 600, wall: 0 });
  const [rectRebarLayers, setRectRebarLayers] = useState<RectRebarLayer[]>(defaultRectRebarLayers);
  const [circleSpec, setCircleSpec] = useState({ diameter: 500, segments: 72, inner: 0 });
  const [circleRebarSpec, setCircleRebarSpec] = useState({ cover: 50, diameter: 25, count: 12 });
  const [demands, setDemands] = useState<DemandInput[]>(defaultDemands);
  const [column, setColumn] = useState<ColumnCondition>(defaultColumnCondition);

  const [showDesign, setShowDesign] = useState(true);
  const [showSimplified, setShowSimplified] = useState(false);
  const [method, setMethod] = useState<IntegrationMethod>(designCodes.kds_strength.defaultIntegration);
  const [taperReduction, setTaperReduction] = useState(false);
  const [reportVisible, setReportVisible] = useState(false);
  const [selectedDemandId, setSelectedDemandId] = useState<string | undefined>("D1");
  const [thetaDeg, setThetaDeg] = useState(90);
  const [contourFraction, setContourFraction] = useState(0.3);
  const [followDemand, setFollowDemand] = useState(true);

  const transverse: TransverseReinforcement = tieTypeToTransverse(column.tieType);
  const sectionIssues = useMemo(() => validateRings(rings), [rings]);

  const surface = useMemo(
    () =>
      computeSurface({ rings, rebars }, materials, {
        designCode,
        thetaSteps: 72,
        cSteps: 60,
        transverseReinforcement: transverse,
        method,
        taperReduction,
      }),
    [rings, rebars, materials, designCode, transverse, method, taperReduction],
  );

  const checks = useMemo(
    () => (surface ? demands.map((demand) => checkDemand(surface, materials, column, demand, showDesign)) : []),
    [surface, materials, column, demands, showDesign],
  );

  const selectedCheck = checks.find((item) => item.demand.input.id === selectedDemandId) ?? checks[0];

  // 하중케이스 연동: 선택된 케이스의 중립축 각도/축력으로 슬라이스와 등고선을 맞춘다.
  const activeTheta =
    followDemand && selectedCheck?.capacity ? selectedCheck.capacity.theta : (thetaDeg * Math.PI) / 180;
  const activeAxial =
    followDemand && selectedCheck ? selectedCheck.demand.input.pu : (surface ? surface.pn0 * contourFraction : 0);

  const sectionProps = useMemo(() => {
    const moments = sectionSecondMoments(rings);
    return { area: sectionArea(rings), centroid: sectionCentroid(rings), ix: moments.ix, iy: moments.iy };
  }, [rings]);

  const report = useMemo(() => {
    if (!surface) return "단면 또는 철근이 정의되지 않아 보고서를 생성할 수 없습니다.";
    const reportColumn: ReportColumn = { ...column };
    return buildReport({ surface, materials, column: reportColumn, demands, rings, rebars, showSimplified });
  }, [surface, materials, column, demands, rings, rebars, showSimplified]);

  // ---- 편집 액션 ----------------------------------------------------------
  /**
   * 설계법을 바꾸면 적분 방식도 그 설계법의 기본값으로 되돌린다.
   * 한계상태설계법은 포물선-직선(파이버)이 기본이다 — 등가블록 계수는 폭이 일정한
   * 압축영역 전제라 2축/고강도에서 압축력을 과대평가한다.
   */
  const changeDesignCode = (id: DesignCodeId) => {
    setDesignCode(id);
    setMethod(designCodes[id].defaultIntegration);
  };

  const updateRingPoint = (ringId: string, index: number, patch: Partial<Point>) => {
    setShapeMode("free");
    setRings((items) =>
      items.map((ring) =>
        ring.id === ringId
          ? { ...ring, points: ring.points.map((point, i) => (i === index ? { ...point, ...patch } : point)) }
          : ring,
      ),
    );
  };
  const addRingPoint = (ringId: string) => {
    setShapeMode("free");
    setRings((items) =>
      items.map((ring) => (ring.id === ringId ? { ...ring, points: [...ring.points, { x: 0, y: 0 }] } : ring)),
    );
  };
  const deleteRingPoint = (ringId: string, index: number) => {
    setShapeMode("free");
    setRings((items) =>
      items.map((ring) => (ring.id === ringId ? { ...ring, points: ring.points.filter((_, i) => i !== index) } : ring)),
    );
  };
  const addRing = (kind: Ring["kind"]) => {
    setShapeMode("free");
    setRings((items) => {
      const prefix = kind === "outer" ? "O" : "H";
      const nextIndex = items.filter((ring) => ring.kind === kind).length + 1;
      const size = kind === "outer" ? 400 : 200;
      return [...items, makeRing(`${prefix}${nextIndex}`, kind, rectanglePolygon(size, size))];
    });
  };
  const deleteRing = (ringId: string) => {
    setShapeMode("free");
    setRings((items) => (items.length <= 1 ? items : items.filter((ring) => ring.id !== ringId)));
  };
  const updateRebar = (id: string, patch: Partial<Rebar>) =>
    setRebars((items) => items.map((bar) => (bar.id === id ? { ...bar, ...patch } : bar)));

  const applyRectangle = () => {
    setShapeMode("rectangle");
    setRings(rectangleRings(rect.width, rect.height, rect.wall));
  };
  const applyRectangleRebars = () => {
    applyRectangle();
    setRebars(generateRectangleRebars(rect.width, rect.height, rectRebarLayers));
  };
  const applyCircle = () => {
    setShapeMode("circle");
    setRings(circleRings(circleSpec.diameter, circleSpec.segments, circleSpec.inner));
  };
  const applyCircleRebars = () => {
    applyCircle();
    setRebars(generateCircleRebars(circleSpec.diameter, circleRebarSpec));
  };

  const applyB5IPreset = () => {
    setShapeMode("rectangle");
    setRect({ width: 1100, height: 1100, wall: 0 });
    setRectRebarLayers(b5iRectRebarLayers);
    setRings(rectangleRings(1100, 1100));
    setMaterials(b5iMaterials);
    setColumn(b5iColumnCondition);
    changeDesignCode("kds_strength");
    setRebars(generateRectangleRebars(1100, 1100, b5iRectRebarLayers));
    setDemands(b5iDemands);
    setSelectedDemandId("D1");
    setReportVisible(true);
  };

  const applyHollowPierPreset = () => {
    setShapeMode("rectangle");
    setRect({ width: 3000, height: 4000, wall: 400 });
    setRectRebarLayers(hollowPierRebarLayers);
    setRings(rectangleRings(3000, 4000, 400));
    setMaterials({ concrete: { fc: 30, ecu: 0.0033 }, steel: { fy: 400, es: 200000 } });
    setColumn({ title: "중공 교각", cover: 100, lu: 12000, kx: 2, ky: 2, tieType: "띠 철근" });
    changeDesignCode("bridge_lsd");
    setRebars(generateRectangleRebars(3000, 4000, hollowPierRebarLayers));
    setDemands([
      { id: "D1", label: "지진 X+Y", pu: 22000, muxNs: 9000, muxS: 0, muyNs: 6500, muyS: 0, betaDx: 0, betaDy: 0 },
    ]);
    setSelectedDemandId("D1");
    setReportVisible(true);
  };

  const resetAll = () => {
    setRings(defaultRings);
    setRebars(defaultRebars);
    setMaterials(defaultMaterials);
    changeDesignCode("kds_strength");
    setShapeMode("rectangle");
    setRect({ width: 400, height: 600, wall: 0 });
    setRectRebarLayers(defaultRectRebarLayers);
    setDemands(defaultDemands);
    setColumn(defaultColumnCondition);
    setSelectedDemandId("D1");
    setReportVisible(false);
  };

  const usesAxialCutoff = designCodes[designCode].designBasis === "strength_reduction";

  return (
    <main className="app-shell">
      <aside className="input-panel">
        <header className="panel-header">
          <div>
            <p className="eyebrow">RC Section</p>
            <h1>2축 P-M 상관도</h1>
          </div>
          <button className="icon-button" title="예제 초기화" onClick={resetAll}>
            <RotateCcw size={18} />
          </button>
        </header>

        <div className="preset-row">
          <button className="preset-button" onClick={applyB5IPreset}>B5-I 예제</button>
          <button className="preset-button" onClick={applyHollowPierPreset}>중공 교각 예제</button>
        </div>

        <section className="panel-section">
          <h2>단면 형상</h2>
          <div className="segmented">
            <button className={shapeMode === "free" ? "active" : ""} onClick={() => setShapeMode("free")}>자유</button>
            <button className={shapeMode === "rectangle" ? "active" : ""} onClick={applyRectangle}><Grid2X2 size={15} />직사각형</button>
            <button className={shapeMode === "circle" ? "active" : ""} onClick={applyCircle}><Circle size={15} />원형</button>
          </div>

          <div className="tool-grid">
            <label>폭 b(mm)<input type="number" value={rect.width} onChange={(e) => setRect({ ...rect, width: readNumber(e.target.value) })} /></label>
            <label>높이 h(mm)<input type="number" value={rect.height} onChange={(e) => setRect({ ...rect, height: readNumber(e.target.value) })} /></label>
            <label>벽두께 t(mm)<input type="number" value={rect.wall} onChange={(e) => setRect({ ...rect, wall: readNumber(e.target.value) })} /></label>
            <button onClick={applyRectangle}>직사각형 생성</button>
          </div>

          <div className="sub-tool">
            <div className="form-grid">
              <label>레이어 개수<input type="number" value={rectRebarLayers.length} min="1" onChange={(e) => setRectRebarLayerCount(readNumber(e.target.value), rectRebarLayers, setRectRebarLayers)} /></label>
            </div>
            <div className="layer-table">
              <div className="layer-head"><span>Layer</span><span>dc</span><span>D</span><span>상</span><span>우</span><span>하</span><span>좌</span></div>
              {rectRebarLayers.map((layer, index) => (
                <div className="layer-row" key={layer.id}>
                  <span>{index + 1}</span>
                  <input type="number" value={layer.dc} onChange={(e) => updateRectRebarLayer(index, { dc: readNumber(e.target.value) }, setRectRebarLayers)} />
                  <input type="number" value={layer.diameter} onChange={(e) => updateRectRebarLayer(index, { diameter: readNumber(e.target.value) }, setRectRebarLayers)} />
                  <input type="number" value={layer.top} onChange={(e) => updateRectRebarLayer(index, { top: readNumber(e.target.value) }, setRectRebarLayers)} />
                  <input type="number" value={layer.right} onChange={(e) => updateRectRebarLayer(index, { right: readNumber(e.target.value) }, setRectRebarLayers)} />
                  <input type="number" value={layer.bottom} onChange={(e) => updateRectRebarLayer(index, { bottom: readNumber(e.target.value) }, setRectRebarLayers)} />
                  <input type="number" value={layer.left} onChange={(e) => updateRectRebarLayer(index, { left: readNumber(e.target.value) }, setRectRebarLayers)} />
                </div>
              ))}
            </div>
            <button onClick={applyRectangleRebars}>직사각형 배근 생성</button>
          </div>

          <div className="tool-grid">
            <label>직경 D(mm)<input type="number" value={circleSpec.diameter} onChange={(e) => setCircleSpec({ ...circleSpec, diameter: readNumber(e.target.value) })} /></label>
            <label>내경 Di(mm)<input type="number" value={circleSpec.inner} onChange={(e) => setCircleSpec({ ...circleSpec, inner: readNumber(e.target.value) })} /></label>
            <label>분할 수<input type="number" value={circleSpec.segments} onChange={(e) => setCircleSpec({ ...circleSpec, segments: readNumber(e.target.value) })} /></label>
            <button onClick={applyCircle}>원형 생성</button>
          </div>

          <div className="sub-tool">
            <div className="form-grid">
              <label>피복(mm)<input type="number" value={circleRebarSpec.cover} onChange={(e) => setCircleRebarSpec({ ...circleRebarSpec, cover: readNumber(e.target.value) })} /></label>
              <label>철근직경(mm)<input type="number" value={circleRebarSpec.diameter} onChange={(e) => setCircleRebarSpec({ ...circleRebarSpec, diameter: readNumber(e.target.value) })} /></label>
              <label>철근 개수<input type="number" value={circleRebarSpec.count} onChange={(e) => setCircleRebarSpec({ ...circleRebarSpec, count: readNumber(e.target.value) })} /></label>
            </div>
            <button onClick={applyCircleRebars}>원형 배근 생성</button>
          </div>
        </section>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>단면 링</h2>
            <div className="ring-actions">
              <button className="chip-button" onClick={() => addRing("outer")}><Plus size={14} />외곽</button>
              <button className="chip-button" onClick={() => addRing("hole")}><Plus size={14} />중공</button>
            </div>
          </div>
          {sectionIssues.length > 0 && (
            <ul className="issue-list">
              {sectionIssues.map((issue, index) => <li key={index} className={issue.level}>{issue.message}</li>)}
            </ul>
          )}
          {rings.map((ring) => (
            <RingEditor
              key={ring.id}
              ring={ring}
              deletable={rings.length > 1}
              onAddPoint={() => addRingPoint(ring.id)}
              onDeleteRing={() => deleteRing(ring.id)}
              onChange={(index, patch) => updateRingPoint(ring.id, index, patch)}
              onDelete={(index) => deleteRingPoint(ring.id, index)}
            />
          ))}
        </section>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>철근</h2>
            <button className="icon-button" title="철근 추가" onClick={() => setRebars((items) => [...items, { id: `R${items.length + 1}`, x: 0, y: 0, diameter: 22 }])}><Plus size={16} /></button>
          </div>
          <RebarTable rebars={rebars} onChange={updateRebar} onDelete={(id) => setRebars((items) => items.filter((bar) => bar.id !== id))} />
        </section>

        <section className="panel-section">
          <div className="section-title-row">
            <h2>검토 부재력 (2축)</h2>
            <button className="icon-button" title="부재력 추가" onClick={() => setDemands((items) => [...items, { id: `D${items.length + 1}`, label: `LC${items.length + 1}`, pu: 0, muxNs: 0, muxS: 0, muyNs: 0, muyS: 0 }])}><Plus size={16} /></button>
          </div>
          <DemandTable
            demands={demands}
            selectedId={selectedDemandId}
            onSelect={setSelectedDemandId}
            onChange={(id, patch) => setDemands((items) => items.map((item) => (item.id === id ? { ...item, ...patch } : item)))}
            onDelete={(id) => setDemands((items) => items.filter((item) => item.id !== id))}
          />
        </section>

        <section className="panel-section">
          <h2>재료 및 설계법</h2>
          <div className="form-grid">
            <label>fck(MPa)<input type="number" value={materials.concrete.fc} onChange={(e) => setMaterials({ ...materials, concrete: { ...materials.concrete, fc: readNumber(e.target.value) } })} /></label>
            <label>ecu<input type="number" step="0.0001" value={materials.concrete.ecu} onChange={(e) => setMaterials({ ...materials, concrete: { ...materials.concrete, ecu: readNumber(e.target.value) } })} /></label>
            <label>Ec(MPa)<input type="number" value={materials.concrete.ec ?? Math.round(8500 * Math.cbrt(materials.concrete.fc + 4))} onChange={(e) => setMaterials({ ...materials, concrete: { ...materials.concrete, ec: readNumber(e.target.value) } })} /></label>
            <label>fy(MPa)<input type="number" value={materials.steel.fy} onChange={(e) => setMaterials({ ...materials, steel: { ...materials.steel, fy: readNumber(e.target.value) } })} /></label>
            <label>Es(MPa)<input type="number" value={materials.steel.es} onChange={(e) => setMaterials({ ...materials, steel: { ...materials.steel, es: readNumber(e.target.value) } })} /></label>
          </div>
          <select value={designCode} onChange={(e) => changeDesignCode(e.target.value as DesignCodeId)}>
            {Object.values(designCodes).map((code) => <option key={code.id} value={code.id}>{code.label}</option>)}
          </select>
        </section>

        <section className="panel-section">
          <h2>부재 조건</h2>
          <div className="form-grid">
            <label>검토 제목<input value={column.title} onChange={(e) => setColumn({ ...column, title: e.target.value })} /></label>
            <label>피복 d'(mm)<input type="number" value={column.cover} onChange={(e) => setColumn({ ...column, cover: readNumber(e.target.value) })} /></label>
            <label>Lu(mm)<input type="number" value={column.lu} onChange={(e) => setColumn({ ...column, lu: readNumber(e.target.value) })} /></label>
            <label>Kx<input type="number" value={column.kx} onChange={(e) => setColumn({ ...column, kx: readNumber(e.target.value) })} /></label>
            <label>Ky<input type="number" value={column.ky} onChange={(e) => setColumn({ ...column, ky: readNumber(e.target.value) })} /></label>
            <label>횡방향 철근
              <select value={column.tieType} onChange={(e) => setColumn({ ...column, tieType: e.target.value })}>
                <option value="띠 철근">띠 철근</option>
                <option value="나선 철근">나선 철근</option>
              </select>
            </label>
          </div>

          <div className="ecc-note">
            {usesAxialCutoff ? (
              <>
                <strong>우발편심: 축력 cutoff</strong>
                <p>
                  강도설계법은 최소편심 조항 대신 축력 상한 α·φ·Pn0 로 곡면 상단을 자릅니다
                  (α = {fmt(surface?.axialLimitFactor ?? 0)}). 최소모멘트는 <em>중복 적용하지 않습니다</em>.
                </p>
                <p className="value">설계 축력상한 = {surface ? fmt(surface.axialCap) : "-"} kN</p>
              </>
            ) : (
              <>
                <strong>우발편심: 최소모멘트</strong>
                <p>한계상태설계법은 강도곡면을 손대지 않고 작용모멘트를 축별로 하한 처리합니다 (e0 = max(h/30, 20mm)).</p>
                <div className="form-grid">
                  <label>e0x(mm)
                    <input type="number" value={column.e0x ?? ""} placeholder="auto"
                      onChange={(e) => setColumn({ ...column, e0x: e.target.value === "" ? undefined : readNumber(e.target.value) })} />
                  </label>
                  <label>e0y(mm)
                    <input type="number" value={column.e0y ?? ""} placeholder="auto"
                      onChange={(e) => setColumn({ ...column, e0y: e.target.value === "" ? undefined : readNumber(e.target.value) })} />
                  </label>
                </div>
              </>
            )}
          </div>
        </section>

        <section className="panel-section">
          <h2>해석 옵션</h2>
          <div className="form-grid">
            <label>압축영역 적분
              <select value={method} onChange={(e) => setMethod(e.target.value as IntegrationMethod)}>
                <option value="equivalent_block">등가직사각형 블록</option>
                <option value="fiber">파이버(포물선-직선)</option>
              </select>
            </label>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={taperReduction} disabled={method !== "equivalent_block"}
              onChange={(e) => setTaperReduction(e.target.checked)} />
            EC2 3.1.7(3) 테이퍼 10% 저감
          </label>
          <label className="toggle">
            <input type="checkbox" checked={showSimplified} onChange={(e) => setShowSimplified(e.target.checked)} />
            간이법(Bresler / EC2 5.8.9) 대조
          </label>
        </section>
      </aside>

      <section className="workbench">
        <div className="viewer-row">
          <div className="viewer">
            <div className="viewer-title">
              <h2>단면 · 중립축</h2>
              <span>{rings.length} 링 / {rebars.length} 철근 / θ = {fmt(radToDeg(activeTheta))}°</span>
            </div>
            <SectionSvg rings={rings} rebars={rebars} theta={activeTheta} c={selectedCheck?.capacity?.c} surface={surface} />
          </div>

          <div className="viewer">
            <div className="viewer-title">
              <h2>Mx-My 등고선</h2>
              <span>P = {fmt(activeAxial)} kN</span>
            </div>
            <ContourSvg surface={surface} axial={activeAxial} useDesign={showDesign} checks={checks} selectedId={selectedDemandId} />
          </div>
        </div>

        <div className="viewer">
          <div className="viewer-title">
            <h2>P-M 방향 슬라이스 (θ = {fmt(radToDeg(activeTheta))}°)</h2>
            <div className="toggle-group">
              <label className="toggle"><input type="checkbox" checked={showDesign} onChange={(e) => setShowDesign(e.target.checked)} />설계강도</label>
              <label className="toggle"><input type="checkbox" checked={followDemand} onChange={(e) => setFollowDemand(e.target.checked)} />하중케이스 연동</label>
            </div>
          </div>
          <div className="slider-row">
            <label>
              <span className="slider-name">중립축 각도 θ</span>
              <input type="range" min="0" max="359" step="1" value={Math.round(radToDeg(activeTheta))} disabled={followDemand}
                onChange={(e) => setThetaDeg(readNumber(e.target.value))} />
              <span className="slider-value">{fmt(radToDeg(activeTheta))}°</span>
            </label>
            <label>
              <span className="slider-name">등고선 축력</span>
              <input type="range" min="-0.1" max="0.9" step="0.01" value={contourFraction} disabled={followDemand}
                onChange={(e) => setContourFraction(readNumber(e.target.value))} />
              <span className="slider-value">{fmt(activeAxial)} kN</span>
            </label>
          </div>
          <SliceSvg surface={surface} theta={activeTheta} useDesign={showDesign} checks={checks} selectedId={selectedDemandId} />
        </div>

        <div className="summary-strip">
          <Metric label="Pn0" value={`${surface ? fmt(surface.pn0) : "-"} kN`} />
          <Metric label={usesAxialCutoff ? "축력 상한" : "순인장"} value={`${surface ? fmt(usesAxialCutoff ? surface.axialCap : surface.pureTension.pn) : "-"} kN`} />
          <Metric label="순단면적 Ac" value={`${sci(sectionProps.area)} mm2`} />
          <Metric label="소성중심" value={surface ? `${fmt(surface.reference.x)}, ${fmt(surface.reference.y)}` : "-"} />
          <Metric label="Ix / Iy" value={`${sci(sectionProps.ix)} / ${sci(sectionProps.iy)}`} />
          <Metric label="설계법" value={designCodes[designCode].label} />
        </div>

        <div className="check-strip">
          {checks.length === 0 && <span className="muted">검토할 하중케이스가 없습니다.</span>}
          {checks.map((check) => (
            <button
              key={check.demand.input.id}
              className={`check-card ${check.ok ? "ok" : "ng"} ${check.demand.input.id === selectedDemandId ? "selected" : ""}`}
              onClick={() => setSelectedDemandId(check.demand.input.id)}
            >
              <strong>{check.demand.input.label}</strong>
              <span>Pu {fmt(check.demand.input.pu)} kN</span>
              <span>|Mu| {fmt(check.demand.mu)} kN-m</span>
              <span>α_e {fmt(radToDeg(check.demand.alphaE))}°</span>
              <span>{check.capacity ? `θ ${fmt(radToDeg(check.capacity.theta))}°` : "해 없음"}</span>
              <span className="ratio">{Number.isFinite(check.ratio) ? `${fmt(check.ratio * 100)} %` : "—"}</span>
              <span className="verdict">{check.ok ? "O.K" : "N.G"}</span>
            </button>
          ))}
        </div>

        <div className="report-panel">
          <div className="viewer-title">
            <h2>검토보고서</h2>
            <button className="report-button" onClick={() => setReportVisible((v) => !v)}><FileText size={16} />검토보고서보기</button>
          </div>
          {reportVisible && <pre>{report}</pre>}
        </div>
      </section>
    </main>
  );
}

// ---------------------------------------------------------------------------
// 단면 뷰
// ---------------------------------------------------------------------------

function SectionSvg({
  rings,
  rebars,
  theta,
  c,
  surface,
}: {
  rings: Ring[];
  rebars: Rebar[];
  theta: number;
  c?: number;
  surface?: InteractionSurface;
}) {
  const frame = getFrame([...rings.flatMap((ring) => ring.points), ...rebars]);
  const { nx, ny } = axisNormal(theta);
  const geo = sectionCentroid(rings);
  const plastic = surface?.reference;
  const frameCenter = { x: frame.minX + frame.width / 2, y: frame.minY + frame.height / 2 };
  const span = Math.hypot(frame.width, frame.height) / 2;

  const na = useMemo(() => {
    if (rings.length === 0 || c === undefined || !Number.isFinite(c) || c <= 0) return undefined;
    const { sMax } = sectionProjectionRange(rings, nx, ny);
    if (!Number.isFinite(sMax)) return undefined;
    const code = surface?.code;
    const beta = code && surface ? code.stressBlock(surface.materials.concrete.fc).beta : 0.8;
    const blockS = sMax - beta * c;
    return {
      naS: sMax - c,
      blockS,
      c,
      a: beta * c,
      compressed: clipRingsHalfPlane(rings, nx, ny, blockS),
    };
  }, [rings, nx, ny, c, surface]);

  return (
    <div className="section-view">
      <svg className="section-svg" viewBox={`${frame.minX} ${frame.minY} ${frame.width} ${frame.height}`}>
        <g transform="scale(1 -1)">
          <path d={ringsToPath(rings)} fillRule="evenodd" className="concrete-shape" />
          {na && na.compressed.length > 0 && (
            <path d={ringsToPath(na.compressed)} fillRule="evenodd" className="stress-block-fill" />
          )}
          {na && <AxisLine nx={nx} ny={ny} s={na.blockS} span={span} center={frameCenter} className="stress-block-edge" />}
          {na && <AxisLine nx={nx} ny={ny} s={na.naS} span={span} center={frameCenter} className="neutral-axis-line" />}

          {rebars.map((bar) => (
            <circle key={bar.id} className="rebar-dot" cx={bar.x} cy={bar.y} r={Math.max(6, bar.diameter / 2)} />
          ))}

          <line className="axis" x1={frame.minX} x2={frame.minX + frame.width} y1="0" y2="0" />
          <line className="axis" x1="0" x2="0" y1={frame.minY} y2={frame.minY + frame.height} />

          <g className="centroid-marker">
            <circle cx={geo.x} cy={geo.y} r={Math.max(5, frame.width * 0.008)} />
          </g>
          {plastic && (
            <g className="plastic-marker">
              <line x1={plastic.x - frame.width * 0.022} x2={plastic.x + frame.width * 0.022} y1={plastic.y} y2={plastic.y} />
              <line x1={plastic.x} x2={plastic.x} y1={plastic.y - frame.width * 0.022} y2={plastic.y + frame.width * 0.022} />
            </g>
          )}
        </g>
      </svg>
      <SectionLegend na={na} />
    </div>
  );
}

/**
 * 단면 뷰 범례.
 *
 * SVG 안의 <text> 로 넣으면 viewBox 가 단면 치수(mm)라서 글자 크기가 단면 크기에 좌우된다
 * (3000x4000 교각에서는 사실상 보이지 않는다). HTML 로 빼고 견본만 작은 SVG 로 그린다.
 */
function SectionLegend({ na }: { na?: { naS: number; blockS: number; a: number; c: number } }) {
  return (
    <ul className="section-legend">
      <li>
        <Swatch kind="line" className="neutral-axis-line" />
        <span className="name">중립축 (N.A.)</span>
        <span className="desc">{na ? `c = ${fmt(na.c)} mm` : "변형률 0 인 선"}</span>
      </li>
      <li>
        <Swatch kind="line" className="stress-block-edge" />
        <span className="name">등가응력블록 하단</span>
        <span className="desc">{na ? `a = β₁c = ${fmt(na.a)} mm` : "a = β₁·c"}</span>
      </li>
      <li>
        <Swatch kind="fill" className="stress-block-fill" />
        <span className="name">압축영역</span>
        <span className="desc">중공 공제됨</span>
      </li>
      <li>
        <Swatch kind="circle" className="centroid-marker" />
        <span className="name">기하 도심</span>
        <span className="desc">콘크리트 단면 중심</span>
      </li>
      <li>
        <Swatch kind="cross" className="plastic-marker" />
        <span className="name">소성중심</span>
        <span className="desc">모멘트 기준점 (KDS 14 20 20)</span>
      </li>
    </ul>
  );
}

function Swatch({ kind, className }: { kind: "line" | "fill" | "circle" | "cross"; className: string }) {
  return (
    <svg className="swatch" viewBox="0 0 22 12" width="22" height="12" aria-hidden="true">
      {kind === "line" && <line className={className} x1="1" y1="6" x2="21" y2="6" vectorEffect="non-scaling-stroke" />}
      {kind === "fill" && <rect className={className} x="1" y="1" width="20" height="10" />}
      {kind === "circle" && (
        <g className={className}>
          <circle cx="11" cy="6" r="4.5" vectorEffect="non-scaling-stroke" />
        </g>
      )}
      {kind === "cross" && (
        <g className={className}>
          <line x1="5" y1="6" x2="17" y2="6" vectorEffect="non-scaling-stroke" />
          <line x1="11" y1="1" x2="11" y2="11" vectorEffect="non-scaling-stroke" />
        </g>
      )}
    </svg>
  );
}

/**
 * s = x·nx + y·ny 인 직선(임의 각도의 중립축)을 그린다.
 *
 * 선분은 화면 중심을 직선 위로 투영한 점을 기준으로 ±span 만 그린다.
 * s·n 을 기준점으로 쓰면 c 가 클 때 선이 화면 밖 먼 곳에서 시작해
 * 불필요하게 긴 파선을 래스터화하게 된다.
 */
function AxisLine({
  nx,
  ny,
  s,
  span,
  center,
  className,
}: {
  nx: number;
  ny: number;
  s: number;
  span: number;
  center: Point;
  className: string;
}) {
  const dx = -ny;
  const dy = nx;
  // 화면 중심에서 직선까지의 법선거리를 빼서 직선 위의 최근접점을 구한다.
  const offset = center.x * nx + center.y * ny - s;
  const base = { x: center.x - offset * nx, y: center.y - offset * ny };
  return (
    <line className={className} x1={base.x - dx * span} y1={base.y - dy * span} x2={base.x + dx * span} y2={base.y + dy * span} />
  );
}

// ---------------------------------------------------------------------------
// Mx-My 등고선 (곡면의 수평 절단)
// ---------------------------------------------------------------------------

function ContourSvg({
  surface,
  axial,
  useDesign,
  checks,
  selectedId,
}: {
  surface?: InteractionSurface;
  axial: number;
  useDesign: boolean;
  checks: DemandCheck[];
  selectedId?: string;
}) {
  const W = 480;
  const H = 420;
  if (!surface) return <svg className="pm-svg" viewBox={`0 0 ${W} ${H}`} />;

  const contour = momentContour(surface, axial, useDesign);
  const demandPoints = checks.map((check) => ({
    id: check.demand.input.id,
    label: check.demand.input.label,
    mx: check.demand.mux,
    my: check.demand.muy,
    ok: check.ok,
  }));

  const values = [
    ...contour.flatMap((p) => [Math.abs(p.mx), Math.abs(p.my)]),
    ...demandPoints.flatMap((p) => [Math.abs(p.mx), Math.abs(p.my)]),
  ];
  const limit = Math.max(1, ...values) * 1.15;
  const cx = W / 2;
  const cy = H / 2;
  const scale = ((Math.min(W, H) / 2) * 0.86) / limit;
  const toX = (my: number) => cx + my * scale;
  const toY = (mx: number) => cy - mx * scale;

  const path =
    contour.length > 2 ? `${contour.map((p, i) => `${i === 0 ? "M" : "L"} ${toX(p.my)} ${toY(p.mx)}`).join(" ")} Z` : "";
  const ticks = buildTicks(-limit, limit, 5);

  return (
    <svg className="pm-svg" viewBox={`0 0 ${W} ${H}`}>
      {ticks.map((t) => (
        <g key={`g${t}`}>
          <line className="chart-grid minor" x1={toX(t)} x2={toX(t)} y1="12" y2={H - 20} />
          <line className="chart-grid minor" x1="16" x2={W - 12} y1={toY(t)} y2={toY(t)} />
        </g>
      ))}
      <line className="chart-grid" x1="16" x2={W - 12} y1={cy} y2={cy} />
      <line className="chart-grid" x1={cx} x2={cx} y1="12" y2={H - 20} />
      {path ? <path d={path} className="contour-line" /> : <text className="muted-svg" x={cx - 90} y={cy}>이 축력에서는 등고선이 없습니다</text>}
      {demandPoints.map((p) => (
        <g key={p.id}>
          <line className="ecc-line" x1={cx} y1={cy} x2={toX(p.my)} y2={toY(p.mx)} />
          <circle
            className={`demand-point ${p.ok ? "ok" : "ng"} ${p.id === selectedId ? "selected" : ""}`}
            cx={toX(p.my)}
            cy={toY(p.mx)}
            r={p.id === selectedId ? 7 : 5}
          />
          <text className="demand-label" x={toX(p.my) + 9} y={toY(p.mx) - 8}>{p.label}</text>
        </g>
      ))}
      <text className="axis-label" x={W - 86} y={cy - 8}>My (kN-m)</text>
      <text className="axis-label" x={cx + 8} y="22">Mx (kN-m)</text>
      <text className="tick-label x" x={W - 76} y={cy + 18}>{fmt(limit)}</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// P-M 방향 슬라이스 (곡면의 수직 절단)
// ---------------------------------------------------------------------------

function SliceSvg({
  surface,
  theta,
  useDesign,
  checks,
  selectedId,
}: {
  surface?: InteractionSurface;
  theta: number;
  useDesign: boolean;
  checks: DemandCheck[];
  selectedId?: string;
}) {
  const W = 820;
  const H = 380;

  // 곡선은 미리 계산된 72방향 중 가장 가까운 것을 고르지 않고, 검토가 수렴시킨
  // **바로 그 θ** 에서 즉석 계산한다. 격자에 스냅하면 사용률 1.0 인 하중점이
  // 곡선 안쪽에 찍혀 여유가 있는 것처럼 보인다 (engine/surface.ts meridianAtTheta 주석).
  // tailSteps: 자오선 c 상한(1.8*h)이 Pn0 에 못 미쳐 고축력 하중점이 곡선 끝 위로
  // 떠 버리는 것을 막는다 (surface.ts MeridianOptions 주석).
  const meridian = useMemo(
    () => (surface ? meridianAtTheta(surface, theta, { tailSteps: 14 }) : []),
    [surface, theta],
  );
  if (!surface || meridian.length === 0) return <svg className="pm-svg" viewBox={`0 0 ${W} ${H}`} />;

  const nominal = meridian.map((p) => ({ m: p.mn, p: p.pn }));
  const design = meridian.map((p) => ({ m: p.md, p: p.pd }));
  const series = useDesign ? design : nominal;

  const demandPoints = checks.map((check) => ({
    id: check.demand.input.id,
    label: check.demand.input.label,
    m: check.demand.mu,
    p: check.demand.input.pu,
    ok: check.ok,
  }));

  // 공칭곡선을 함께 그릴 때는 그 값도 축 범위에 포함해야 차트 밖으로 벗어나지 않는다.
  const shown = useDesign ? [...design, ...nominal] : nominal;
  const xs = [...shown.map((s) => s.m), ...demandPoints.map((d) => d.m), 0];
  const ys = [...shown.map((s) => s.p), ...demandPoints.map((d) => d.p), surface.pureTension.pn];
  const minX = Math.min(...xs, 0);
  const maxX = Math.max(...xs, 1) * 1.1;
  const minY = Math.min(...ys) * 1.1;
  const maxY = Math.max(...ys) * 1.05;

  const L = 66;
  const R = W - 24;
  const T = 20;
  const B = H - 34;
  const toX = (m: number) => map(m, minX, maxX, L, R);
  const toY = (p: number) => map(p, minY, maxY, B, T);

  const line = series.map((s, i) => `${i === 0 ? "M" : "L"} ${toX(s.m)} ${toY(s.p)}`).join(" ");
  const nominalLine = nominal.map((s, i) => `${i === 0 ? "M" : "L"} ${toX(s.m)} ${toY(s.p)}`).join(" ");
  const xTicks = buildTicks(minX, maxX, 6);
  const yTicks = buildTicks(minY, maxY, 6);
  // 축력 cutoff 선은 설계곡선이 상한에 닿는 지점까지만 그린다.
  // 그 오른쪽까지 이으면 존재하지 않는 강도가 있는 것처럼 보인다.
  const capActive = useDesign && Number.isFinite(surface.axialCap) && surface.axialLimitFactor < 1;
  const capY = capActive ? toY(surface.axialCap) : undefined;
  const capMaxMoment = capActive
    ? Math.max(0, ...design.filter((s, i) => meridian[i].cappedByAxialLimit).map((s) => s.m))
    : 0;

  return (
    <svg className="pm-svg" viewBox={`0 0 ${W} ${H}`}>
      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line className="chart-grid minor" x1={toX(t)} x2={toX(t)} y1={T} y2={B} />
          <text className="tick-label x" x={toX(t)} y={B + 16}>{fmt(t)}</text>
        </g>
      ))}
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line className="chart-grid minor" x1={L} x2={R} y1={toY(t)} y2={toY(t)} />
          <text className="tick-label y" x={L - 8} y={toY(t) + 4}>{fmt(t)}</text>
        </g>
      ))}
      <line className="chart-grid" x1={L} x2={R} y1={toY(0)} y2={toY(0)} />
      <line className="chart-grid" x1={toX(0)} x2={toX(0)} y1={T} y2={B} />

      {useDesign && <path d={nominalLine} className="failure-line" />}
      <path d={line} className="pm-line" />

      {capY !== undefined && (
        <>
          <line className="cutoff-line" x1={toX(0)} x2={toX(capMaxMoment)} y1={capY} y2={capY} />
          <text className="cutoff-label" x={L + 8} y={capY - 7}>축력 상한 α·φ·Pn0 = {fmt(surface.axialCap)} kN</text>
        </>
      )}

      {demandPoints.map((d) => (
        <g key={d.id}>
          <circle
            className={`demand-point ${d.ok ? "ok" : "ng"} ${d.id === selectedId ? "selected" : ""}`}
            cx={toX(d.m)}
            cy={toY(d.p)}
            r={d.id === selectedId ? 7 : 5}
          />
          <text className="demand-label" x={toX(d.m) + 9} y={toY(d.p) - 8}>{d.label}</text>
        </g>
      ))}

      <text className="axis-label" x={L} y={H - 6}>|M| (kN-m)</text>
      <text className="axis-label" x="8" y={T + 4}>P (kN)</text>
      {useDesign && <text className="legend-text" x={R - 160} y={T + 18}>공칭 Pn-Mn</text>}
      <text className="legend-text" x={R - 160} y={T + 36}>{useDesign ? "설계 φPn-φMn" : "공칭 Pn-Mn"}</text>
    </svg>
  );
}

// ---------------------------------------------------------------------------
// 표
// ---------------------------------------------------------------------------

function RingEditor({
  ring,
  deletable,
  onAddPoint,
  onDeleteRing,
  onChange,
  onDelete,
}: {
  ring: Ring;
  deletable: boolean;
  onAddPoint: () => void;
  onDeleteRing: () => void;
  onChange: (index: number, patch: Partial<Point>) => void;
  onDelete: (index: number) => void;
}) {
  return (
    <div className={`ring-block ${ring.kind}`}>
      <div className="ring-head">
        <span className={`ring-tag ${ring.kind}`}>{ring.kind === "outer" ? "외곽" : "중공"}</span>
        <span className="ring-id">{ring.id}</span>
        <span className="ring-area">{sci(Math.abs(signedArea(ring.points)))} mm2</span>
        <button className="icon-button" title="절점 추가" onClick={onAddPoint}><Plus size={15} /></button>
        <button className="icon-button danger" title="링 삭제" disabled={!deletable} onClick={onDeleteRing}><Trash2 size={15} /></button>
      </div>
      {ring.points.length <= 24 ? (
        <div className="data-table">
          <div className="table-head"><span>#</span><span>X</span><span>Y</span><span /></div>
          {ring.points.map((point, index) => (
            <div className="table-row" key={index}>
              <span>{index + 1}</span>
              <input type="number" value={round(point.x)} onChange={(e) => onChange(index, { x: readNumber(e.target.value) })} />
              <input type="number" value={round(point.y)} onChange={(e) => onChange(index, { y: readNumber(e.target.value) })} />
              <button className="icon-button danger" onClick={() => onDelete(index)}><Trash2 size={15} /></button>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted small">절점 {ring.points.length}개 — 생성기 형상이므로 표 편집을 생략합니다.</p>
      )}
    </div>
  );
}

function RebarTable({ rebars, onChange, onDelete }: { rebars: Rebar[]; onChange: (id: string, patch: Partial<Rebar>) => void; onDelete: (id: string) => void }) {
  if (rebars.length > 40) {
    return <p className="muted small">철근 {rebars.length}본 — 생성기 배근이므로 표 편집을 생략합니다.</p>;
  }
  return (
    <div className="data-table rebar-table">
      <div className="table-head"><span>ID</span><span>X</span><span>Y</span><span>D</span><span /></div>
      {rebars.map((bar) => (
        <div className="table-row" key={bar.id}>
          <span>{bar.id}</span>
          <input type="number" value={bar.x} onChange={(e) => onChange(bar.id, { x: readNumber(e.target.value) })} />
          <input type="number" value={bar.y} onChange={(e) => onChange(bar.id, { y: readNumber(e.target.value) })} />
          <input type="number" value={bar.diameter} onChange={(e) => onChange(bar.id, { diameter: readNumber(e.target.value) })} />
          <button className="icon-button danger" onClick={() => onDelete(bar.id)}><Trash2 size={15} /></button>
        </div>
      ))}
    </div>
  );
}

function DemandTable({
  demands,
  selectedId,
  onSelect,
  onChange,
  onDelete,
}: {
  demands: DemandInput[];
  selectedId?: string;
  onSelect: (id: string) => void;
  onChange: (id: string, patch: Partial<DemandInput>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="data-table demand-table">
      <div className="table-head">
        <span>명칭</span><span>Pu</span><span>Mux.ns</span><span>Mux.s</span><span>Muy.ns</span><span>Muy.s</span><span />
      </div>
      {demands.map((demand) => (
        <div
          className={`table-row ${demand.id === selectedId ? "selected" : ""}`}
          key={demand.id}
          onFocus={() => onSelect(demand.id)}
        >
          <input value={demand.label} onChange={(e) => onChange(demand.id, { label: e.target.value })} />
          <input type="number" value={demand.pu} onChange={(e) => onChange(demand.id, { pu: readNumber(e.target.value) })} />
          <input type="number" value={demand.muxNs} onChange={(e) => onChange(demand.id, { muxNs: readNumber(e.target.value) })} />
          <input type="number" value={demand.muxS} onChange={(e) => onChange(demand.id, { muxS: readNumber(e.target.value) })} />
          <input type="number" value={demand.muyNs} onChange={(e) => onChange(demand.id, { muyNs: readNumber(e.target.value) })} />
          <input type="number" value={demand.muyS} onChange={(e) => onChange(demand.id, { muyS: readNumber(e.target.value) })} />
          <button className="icon-button danger" onClick={() => onDelete(demand.id)}><Trash2 size={15} /></button>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div className="metric"><span>{label}</span><strong>{value}</strong></div>;
}

// ---------------------------------------------------------------------------
// 유틸
// ---------------------------------------------------------------------------

/** 링 집합 -> SVG path. fill-rule="evenodd" 와 함께 써야 중공이 뚫린다. */
function ringsToPath(rings: Ring[]): string {
  return rings
    .filter((ring) => ring.points.length >= 3)
    .map((ring) => `M ${ring.points.map((p) => `${p.x},${p.y}`).join(" L ")} Z`)
    .join(" ");
}

function tieTypeToTransverse(tieType: string): TransverseReinforcement {
  return tieType === "나선 철근" ? "spiral" : "tie";
}

function setRectRebarLayerCount(
  countValue: number,
  layers: RectRebarLayer[],
  setLayers: (layers: RectRebarLayer[]) => void,
) {
  const count = Math.max(1, Math.round(countValue));
  if (count === layers.length) return;
  if (count < layers.length) {
    setLayers(layers.slice(0, count));
    return;
  }
  const next = [...layers];
  while (next.length < count) {
    const previous = next[next.length - 1] ?? defaultRectRebarLayers[0];
    next.push({ ...previous, id: `L${next.length + 1}`, dc: previous.dc + 30 });
  }
  setLayers(next);
}

function updateRectRebarLayer(
  index: number,
  patch: Partial<RectRebarLayer>,
  setLayers: Dispatch<SetStateAction<RectRebarLayer[]>>,
) {
  setLayers((layers) => layers.map((layer, i) => (i === index ? { ...layer, ...patch } : layer)));
}

function readNumber(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function map(value: number, inMin: number, inMax: number, outMin: number, outMax: number): number {
  if (Math.abs(inMax - inMin) < 1e-9) return (outMin + outMax) / 2;
  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

function buildTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || count < 2) return [];
  const step = niceStep((max - min) / (count - 1));
  const start = Math.ceil(min / step) * step;
  const ticks: number[] = [];
  for (let value = start; value <= max + step * 0.25; value += step) {
    ticks.push(Math.abs(value) < step * 1e-6 ? 0 : round(value));
  }
  return ticks;
}

function niceStep(rawStep: number): number {
  if (!Number.isFinite(rawStep) || rawStep <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(rawStep));
  const fraction = rawStep / power;
  if (fraction <= 1) return power;
  if (fraction <= 2) return 2 * power;
  if (fraction <= 5) return 5 * power;
  return 10 * power;
}

function getFrame(items: Point[]) {
  const box = outerBounds([{ id: "frame", kind: "outer", points: items }]);
  const minX = Math.min(box.minX, -300);
  const maxX = Math.max(box.maxX, 300);
  const minY = Math.min(box.minY, -300);
  const maxY = Math.max(box.maxY, 300);
  const pad = Math.max(maxX - minX, maxY - minY) * 0.12 + 40;
  return { minX: minX - pad, minY: minY - pad, width: maxX - minX + pad * 2, height: maxY - minY + pad * 2 };
}
