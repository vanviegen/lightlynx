import { dump } from 'aberdeen';
import api from '../api';
import { routeState } from '../ui';

export function drawDumpPage(): void {
    routeState.title = 'State dump';
    dump(api.store);
}
