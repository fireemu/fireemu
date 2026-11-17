"""Run AUTH-EDGES with the existing owned strict-Auth shadow supervisor."""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import edges
import action_codes_shadow as shadow


def main():
    args = shadow.build_parser().parse_args()
    if args.project != edges.PROJECT:
        raise ValueError('the edge packet project is required')
    if args.child is not None:
        origin = shadow.loopback_origin(os.environ['FIREBASE_AUTH_EMULATOR_HOST'])
        args.child.mkdir(parents=True, exist_ok=True)
        (args.child / 'instance.json').write_text(json.dumps({'childPid': os.getpid(), 'parentPid': os.getppid(), 'authOrigin': origin, 'nonce': args.nonce}) + '\n')
        sender = edges.local_send(origin)
        # AUTH-ACTION prepares this baseline only on its owned local emulator.
        mask = 'signIn.email.enabled,signIn.email.passwordRequired,signIn.phoneNumber,authorizedDomains,notification.defaultLocale,mfa'
        baseline = {'signIn': {'email': {'enabled': True, 'passwordRequired': True}, 'phoneNumber': {'enabled': True, 'testPhoneNumbers': {n: edges.TEST_PHONE_CODE for n in edges.TEST_PHONES}}}, 'authorizedDomains': [edges.DOMAIN], 'notification': {'defaultLocale': 'en'}, 'mfa': {'state': 'DISABLED'}}
        status, _ = sender({'path': edges.CONFIG + '?updateMask=' + mask, 'owner': True, 'method': 'PATCH', 'kind': 'config'}, baseline)
        if status != 200:
            raise ValueError('local baseline preparation failed')
        receipt = edges.collect(nonce=args.nonce, output=args.child / 'stage', send=sender)
        (args.child / 'receipt.json').write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
        return 0 if receipt['recordingComplete'] and receipt['cleanupComplete'] else 2
    if args.fail_after or args.built_from_source_commit:
        raise ValueError('use stage failure tests; retained artifacts do not assert source provenance')
    if args.output is None or args.artifact is None:
        raise ValueError('output and retained artifact are required')
    # Reuse process ownership, port selection, environment stripping and listener proof.
    # Put every temporary file under the requested worktree output, never OS temp.
    args.output = args.output.resolve()
    args.output.mkdir(parents=True, exist_ok=False)
    original = shadow.artifact_command

    def command(*arguments):
        argv = original(*arguments)
        argv[argv.index(str(Path(shadow.__file__).resolve()))] = str(Path(__file__).resolve())
        return argv

    with patch.object(shadow, 'artifact_command', command), patch.object(tempfile, 'tempdir', str(args.output)):
        report = shadow.run(args.output, args.artifact, edges.PROJECT, args.nonce, timeout=2400)
    print(json.dumps({'status': report['status'], 'ownedProcess': report.get('ownedProcess')}))
    return 0 if report['status'] == 'shadow-complete' else 2


if __name__ == '__main__':
    raise SystemExit(main())
