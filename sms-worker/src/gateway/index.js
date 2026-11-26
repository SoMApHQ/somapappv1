// Picks the gateway for a mode, with key-prefix safety checks:
//   dryrun  -> nothing is sent
//   sandbox -> SWALASMS_TEST_KEY, must start with swl_test_
//   live    -> SWALASMS_LIVE_KEY, must start with swl_live_
import { HttpError } from '../http.js';
import { createDryRunGateway } from './dryrun.js';
import { createSwalaGateway } from './swalasms.js';

export const MODES = ['dryrun', 'sandbox', 'live'];

export function keyFor(kind, env) {
  if (kind === 'test') {
    const k = String(env.SWALASMS_TEST_KEY || '').trim();
    if (!k) throw new HttpError(503, 'NO_TEST_KEY', 'Ufunguo wa majaribio (swl_test_) haujawekwa.', 'SWALASMS_TEST_KEY is not set.');
    if (!k.startsWith('swl_test_')) throw new HttpError(503, 'WRONG_TEST_KEY', 'Ufunguo wa majaribio si sahihi: lazima uanze na swl_test_.', 'SWALASMS_TEST_KEY must start with swl_test_.');
    return k;
  }
  if (kind === 'live') {
    const k = String(env.SWALASMS_LIVE_KEY || '').trim();
    if (!k) throw new HttpError(503, 'NO_LIVE_KEY', 'Ufunguo halisi (swl_live_) haujawekwa.', 'SWALASMS_LIVE_KEY is not set.');
    if (!k.startsWith('swl_live_')) throw new HttpError(503, 'WRONG_LIVE_KEY', 'Ufunguo halisi si sahihi: lazima uanze na swl_live_.', 'SWALASMS_LIVE_KEY must start with swl_live_.');
    return k;
  }
  throw new HttpError(400, 'BAD_KEY_KIND', 'Aina ya ufunguo haijulikani.', 'key must be test or live.');
}

export function gatewayForMode(mode, env, fetchImpl = fetch) {
  if (mode === 'dryrun') return createDryRunGateway();
  if (mode === 'sandbox') return createSwalaGateway({ apiKey: keyFor('test', env), fetchImpl });
  if (mode === 'live') {
    if (String(env.LIVE_ENABLED) !== 'true') throw new HttpError(403, 'LIVE_LOCKED', 'Utumaji halisi umefungwa kwa sasa.', 'Live sending is locked (LIVE_ENABLED=false).');
    return createSwalaGateway({ apiKey: keyFor('live', env), fetchImpl });
  }
  throw new HttpError(500, 'BAD_MODE', 'Hali ya mfumo si sahihi.', `Unknown mode ${mode}.`);
}

export function gatewayForKey(kind, env, fetchImpl = fetch) {
  return createSwalaGateway({ apiKey: keyFor(kind, env), fetchImpl });
}
