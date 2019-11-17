import { BehaviorSubject, combineLatest, Subject } from 'rxjs';
import { publishReplay, refCount, skip, switchMap, takeUntil, tap } from 'rxjs/operators';
import { NodeInterface } from '../node';
import { NoraService } from '../nora';
import { convertValueType, getValue } from './util';

module.exports = function (RED) {
    RED.nodes.registerType('nora-lock', function (this: NodeInterface, config) {
        RED.nodes.createNode(this, config);

        const noraConfig = RED.nodes.getNode(config.nora);
        if (!noraConfig || !noraConfig.token) { return; }

        const close$ = new Subject();
        const lock$ = new BehaviorSubject(false);
        const stateString$ = new Subject<string>();

        const { value: lockValue, type: lockType } = convertValueType(RED, config.lockvalue, config.lockvalueType, { defaultValue: true });
        const { value: unlockValue, type: unlockType } = convertValueType(RED, config.unlockvalue, config.unlockvalueType, { defaultValue: false });

        const device$ = NoraService
            .getService(RED)
            .getConnection(noraConfig, this, stateString$)
            .pipe(
                switchMap(connection => connection.addDevice(config.id, {
                    type: 'lock',
                    name: config.devicename,
                    roomHint: config.roomhint || undefined,
                    state: { online: true, lock: lock$.value },
                })),
                publishReplay(1),
                refCount(),
                takeUntil(close$),
            );

        combineLatest(device$, lock$)
            .pipe(
                tap(([_, lock]) => notifyState(lock)),
                skip(1),
                takeUntil(close$),
            )
            .subscribe(([device, lock]) => device.updateState({ lock }));

        device$.pipe(
            switchMap(d => d.errors$),
            takeUntil(close$),
        ).subscribe(err => this.warn(err));

        device$.pipe(
            switchMap(d => d.state$),
            takeUntil(close$),
        ).subscribe(s => {
            const value = s.lock;
            notifyState(s.lock);
            this.send({
                payload: getValue(RED, this, value ? lockValue : unlockValue, value ? lockType : unlockType),
                topic: config.topic
            });
        });

        this.lock('input', msg => {
            if (config.passthru) {
                this.send(msg);
            }
            const myLockValue = getValue(RED, this, lockValue, lockType);
            const myUnlockValue = getValue(RED, this, unlockValue, unlockType);
            if (RED.util.compareObjects(myLockValue, msg.payload)) {
                lock$.next(true);
            } else if (RED.util.compareObjects(myUnlockValue, msg.payload)) {
                lock$.next(false);
            }
        });

        this.lock('close', () => {
            close$.next();
            close$.complete();
        });

        function notifyState(lock: boolean) {
            stateString$.next(`(${lock ? 'lock' : 'unlock'})`);
        }
    });
};
