import { build } from 'esbuild';
const bundle = await build({ entryPoints: [new URL('../../../packages/client/src/sessionLabels.ts', import.meta.url).pathname], bundle: true, format: 'cjs', platform: 'node', write: false });
const mod = { exports: {} }; new Function('module', 'exports', bundle.outputFiles[0].text)(mod, mod.exports);
export const labels = mod.exports;
export const labelComponentStubs = { LabelPills: 'LabelPills', LabelsFilter: 'LabelsFilter', LabelsEditorPage: 'LabelsEditorPage' };
