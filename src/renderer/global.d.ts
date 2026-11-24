import type {api} from '../preload';
declare global { interface Window { compose: typeof api; } }
export {};
