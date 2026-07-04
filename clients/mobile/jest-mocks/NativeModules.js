/**
 * Shim for react-native/Libraries/BatchedBridge/NativeModules.
 *
 * jest-expo 53 setup.js accesses `.default` on this module, but the RN 0.76
 * mock returns a plain CJS object with no `.default`. This shim wraps the
 * actual RN mock and re-exposes it as both the default export and named
 * exports so that both access patterns work.
 */
"use strict";

const nativeModulesMock = {
  AlertManager: {
    alertWithArgs: jest.fn(),
  },
  AsyncLocalStorage: {
    multiGet: jest.fn((keys, callback) =>
      process.nextTick(() => callback(null, [])),
    ),
    multiSet: jest.fn((entries, callback) =>
      process.nextTick(() => callback(null)),
    ),
    multiRemove: jest.fn((keys, callback) =>
      process.nextTick(() => callback(null)),
    ),
    multiMerge: jest.fn((entries, callback) =>
      process.nextTick(() => callback(null)),
    ),
    clear: jest.fn((callback) => process.nextTick(() => callback(null))),
    getAllKeys: jest.fn((callback) =>
      process.nextTick(() => callback(null, [])),
    ),
  },
  DeviceInfo: {
    getConstants() {
      return {
        Dimensions: {
          window: { fontScale: 2, height: 1334, scale: 2, width: 750 },
          screen: { fontScale: 2, height: 1334, scale: 2, width: 750 },
        },
      };
    },
  },
  DevSettings: {
    addMenuItem: jest.fn(),
    reload: jest.fn(),
  },
  ImageLoader: {
    prefetchImage: jest.fn(),
    getSize: jest.fn((uri, success) => process.nextTick(() => success(320, 240))),
  },
  ImageViewManager: {
    prefetchImage: jest.fn(),
    getSize: jest.fn((uri, success) => process.nextTick(() => success(320, 240))),
  },
  KeyboardObserver: {},
  Networking: {
    sendRequest: jest.fn(),
    abortRequest: jest.fn(),
    clearCookies: jest.fn(),
  },
  PlatformConstants: {
    getConstants() {
      return {};
    },
  },
  RCTDeviceEventEmitter: {
    addListener: jest.fn(),
    removeAllListeners: jest.fn(),
  },
  RCTEventEmitter: {
    register: jest.fn(),
  },
  StatusBarManager: {
    getHeight: jest.fn(),
    setStyle: jest.fn(),
    setHidden: jest.fn(),
    setNetworkActivityIndicatorVisible: jest.fn(),
  },
  Timing: {
    createTimer: jest.fn(),
    deleteTimer: jest.fn(),
  },
  UIManager: {
    customBubblingEventTypes: {},
    customDirectEventTypes: {},
    Dimensions: {},
    measure: jest.fn(),
    measureInWindow: jest.fn(),
    measureLayout: jest.fn(),
    dispatchViewManagerCommand: jest.fn(),
    setChildren: jest.fn(),
    updateView: jest.fn(),
    createView: jest.fn(),
    manageChildren: jest.fn(),
    removeSubviews: jest.fn(),
    replaceExistingNonRootView: jest.fn(),
    setJSResponder: jest.fn(),
    clearJSResponder: jest.fn(),
    findSubviewIn: jest.fn(),
    blur: jest.fn(),
    focus: jest.fn(),
    getConstants: jest.fn(() => ({
      customBubblingEventTypes: {},
      customDirectEventTypes: {},
      Dimensions: {},
    })),
    getViewManagerConfig: jest.fn(() => ({
      Commands: {},
    })),
    lazilyLoadView: jest.fn(),
    sendAccessibilityEvent: jest.fn(),
    configureNextLayoutAnimation: jest.fn(),
    configureNextLayoutAnimationBatch: jest.fn(),
    setAccessibilityFocus: jest.fn(),
  },
  WebSocketModule: {
    connect: jest.fn(),
    send: jest.fn(),
    sendBinary: jest.fn(),
    ping: jest.fn(),
    close: jest.fn(),
  },
};

// jest-expo setup.js accesses `.default`; RN's CJS mock doesn't set it.
// Expose both so both access patterns work.
nativeModulesMock.default = nativeModulesMock;

module.exports = nativeModulesMock;
