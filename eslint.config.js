export default [
  { ignores: ["node_modules/**", "coverage/**"] },
  {
    files: ["**/*.js"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module" },
    rules: {
      "no-unreachable": "error",
      "no-constant-condition": "error",
      "no-dupe-keys": "error",
      "no-undef": "off",
    },
  },
];
