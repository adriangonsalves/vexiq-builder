/**
 * Fixture shots for checking the capture script and the Help panel before real pages exist
 * (openspec in-app-help, tasks 4.1 and 4.3). Names start with `fixture-`, which the help check
 * ignores and the static build leaves out.
 */
export default [
  {
    name: 'fixture-toolbar',
    layout: 'large',
    crop: ['toolbar'],
    marks: ['control:Tools']
  }
];
