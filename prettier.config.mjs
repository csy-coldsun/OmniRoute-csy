const prettierConfig = {
  semi: true,
  singleQuote: false,
  tabWidth: 2,
  trailingComma: "es5",
  printWidth: 100,
  overrides: [
    {
      files: "*.mjs",
      options: {
        parser: "babel",
      },
    },
    {
      files: "tests/**/*.mjs",
      options: {
        ignore: true, // Skip formatting test files
      },
    },
  ],
};

export default prettierConfig;
