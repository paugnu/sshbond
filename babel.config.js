module.exports = function (api) {
  api.cache(true);
  return {
    // babel-preset-expo pulls in the worklets plugin that Reanimated 4 needs;
    // naming a plugin here as well would register it twice.
    presets: ['babel-preset-expo'],
  };
};
