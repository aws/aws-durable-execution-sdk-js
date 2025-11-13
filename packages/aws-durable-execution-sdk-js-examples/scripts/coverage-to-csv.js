const fs = require("fs");
const path = require("path");
const xml2js = require("xml2js");

const coverageFile = path.resolve(
  __dirname,
  "../coverage-sdk/cobertura-coverage.xml",
);
const outputFile = path.resolve(__dirname, "../coverage-sdk/coverage.csv");

if (!fs.existsSync(coverageFile)) {
  console.error(
    "Coverage file not found. Run 'npm run test-with-sdk-coverage' first.",
  );
  process.exit(1);
}

const xml = fs.readFileSync(coverageFile, "utf8");

xml2js.parseString(xml, (err, result) => {
  if (err) {
    console.error("Error parsing XML:", err);
    process.exit(1);
  }

  const packages = result.coverage.packages[0].package;
  const rows = [["File", "Line Coverage %"]];

  packages.forEach((pkg) => {
    pkg.classes[0].class.forEach((cls) => {
      const filename = cls.$.filename;
      const lineRate = (parseFloat(cls.$["line-rate"]) * 100).toFixed(2);
      rows.push([filename, lineRate]);
    });
  });

  const csv = rows.map((row) => row.join(",")).join("\n");
  fs.writeFileSync(outputFile, csv);
  console.log(`✓ Coverage CSV written to ${outputFile}`);
  console.log(`  Total files: ${rows.length - 1}`);
});
