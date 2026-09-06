import { AppLockController, AppLockState } from '../../src/services/secureStorage/AppLockController';

const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

function setup(required = true) {
  const read = jest.fn(async () => required);
  const authenticate = jest.fn(async () => true);
  const states: AppLockState[] = [];
  const controller = new AppLockController(read, authenticate, state => states.push(state));
  return { controller, read, authenticate, states };
}

it('hides content on background and requires fresh authentication on return', async () => {
  const { controller, authenticate, states } = setup();
  await controller.unlock();
  controller.onAppStateChange('background');
  expect(states.at(-1)).toBe('locked');
  authenticate.mockResolvedValue(false);
  controller.onAppStateChange('active');
  await flush();
  expect(authenticate).toHaveBeenCalledTimes(2);
  expect(states.at(-1)).toBe('locked');
});

it('does not treat cancellation or settings read errors as authorization', async () => {
  const { controller, read, authenticate, states } = setup();
  authenticate.mockResolvedValue(false);
  await controller.unlock();
  expect(states.at(-1)).toBe('locked');
  read.mockRejectedValue(new Error('Unreadable settings'));
  await controller.unlock();
  expect(states.at(-1)).toBe('locked');
  expect(authenticate).toHaveBeenCalledTimes(1);
});

it('does not reuse authentication that finished after going to background', async () => {
  const { controller, authenticate, states } = setup();
  let resolve!: (value: boolean) => void;
  authenticate.mockReturnValue(new Promise<boolean>(done => { resolve = done; }));
  const pending = controller.unlock();
  await flush();
  controller.onAppStateChange('background');
  controller.onAppStateChange('active');
  resolve(true);
  await pending;
  expect(states.at(-1)).toBe('locked');
});

it('allows the inactive transition caused by the biometric dialog', async () => {
  const { controller, authenticate, states } = setup();
  let resolve!: (value: boolean) => void;
  authenticate.mockReturnValue(new Promise<boolean>(done => { resolve = done; }));
  const pending = controller.unlock();
  await flush();
  controller.onAppStateChange('inactive');
  resolve(true);
  await pending;
  expect(states.at(-1)).toBe('locked');
  controller.onAppStateChange('active');
  expect(states.at(-1)).toBe('unlocked');
  expect(authenticate).toHaveBeenCalledTimes(1);
});

it('re-reads the preference so enabling the lock takes effect on return', async () => {
  const { controller, read, authenticate, states } = setup(false);
  await controller.unlock();
  expect(authenticate).not.toHaveBeenCalled();
  read.mockResolvedValue(true);
  authenticate.mockResolvedValue(false);
  controller.onAppStateChange('background');
  controller.onAppStateChange('active');
  await flush();
  expect(states.at(-1)).toBe('locked');
  expect(authenticate).toHaveBeenCalledTimes(1);
});

it('does not reopen the biometric prompt after cancelling its inactive dialog', async () => {
  const { controller, authenticate, states } = setup();
  let resolve!: (value: boolean) => void;
  authenticate.mockReturnValue(new Promise<boolean>(done => { resolve = done; }));
  const pending = controller.unlock();
  await flush();
  controller.onAppStateChange('inactive');
  resolve(false);
  await pending;
  controller.onAppStateChange('active');
  await flush();
  expect(states.at(-1)).toBe('locked');
  expect(authenticate).toHaveBeenCalledTimes(1);
});
