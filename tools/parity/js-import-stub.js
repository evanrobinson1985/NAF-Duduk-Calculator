const handler = {
  get: (t, p) => {
    if (p === 'default') return makeStub();
    if (p === Symbol.toPrimitive) return () => 'stub';
    return makeStub();
  },
  apply: () => makeStub(),
  construct: () => makeStub(),
};
function makeStub() { return new Proxy(function stub() {}, handler); }
const s = makeStub();
export default s;
export const jsPDF = s;
export const OrbitControls = s;
export const mergeGeometries = s;
export const Brush = s, Evaluator = s, SUBTRACTION = s, ADDITION = s, INTERSECTION = s;
export const STLLoader = s, STLExporter = s, OBJExporter = s, PLYExporter = s, GLTFExporter = s;
