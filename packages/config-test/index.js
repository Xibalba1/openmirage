export const nodeTestConfig = {
  test: {
    clearMocks: true,
    mockReset: true,
    restoreMocks: true
  }
};

export const jsdomTestConfig = {
  test: {
    ...nodeTestConfig.test,
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"]
  }
};
