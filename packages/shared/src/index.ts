export * from './permissions';
export * from './asset-types';
export * from './assets';
export * from './telemetry';
export * from './workflow';
export * from './reports';

// Domain modules register their asset types, templates, and report
// categories on import (side effect).
import './modules/drainage';
import './modules/flood';
import './modules/pumps';
import './modules/slopes';
import './modules/lighting';
import './modules/bins';
import './modules/traffic';
import './modules/trees';
import './modules/toilets';
import './modules/accessibility';
