// Test the complete flow: original data -> sanitized -> JSON string
function sanitizeToolResultForText(toolResultData) {
  if (typeof toolResultData !== 'object' || toolResultData === null) {
    return toolResultData;
  }
  const sanitized = { ...toolResultData };
  if (sanitized.hasOwnProperty('imageData')) {
    delete sanitized.imageData;
  }
  return sanitized;
}

const performActionResult = {
  imageData: "data:image/png;base64," + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB...".repeat(50), // Simulate large base64
  xpath: "//button[@id='submit']",
  pageChange: {
    hasChanges: true,
    summary: "Button clicked, form submitted",
    added: ["Success message appeared"],
    removed: [],
    modified: ["Button state changed to disabled"]
  },
  visualCheck: "Successfully clicked submit button. Form was submitted and success message appeared."
};

console.log("=== BEFORE FIX (what LLM text would contain) ===");
const beforeFix = JSON.stringify(performActionResult, null, 2);
console.log("Character count:", beforeFix.length);
console.log("Contains imageData:", beforeFix.includes('imageData'));
console.log("Sample:", beforeFix.substring(0, 200) + "...");

console.log("\n=== AFTER FIX (sanitized for LLM text) ===");
const afterFix = JSON.stringify(sanitizeToolResultForText(performActionResult), null, 2);
console.log("Character count:", afterFix.length);
console.log("Contains imageData:", afterFix.includes('imageData'));
console.log("Full sanitized JSON:\n", afterFix);

console.log("\n=== IMAGE DATA STILL AVAILABLE FOR MULTIMODAL ===");
console.log("Original imageData available:", performActionResult.imageData !== undefined);
console.log("ImageData length:", performActionResult.imageData.length);

console.log("\n=== TOKEN SAVINGS CALCULATION ===");
const tokenSavings = beforeFix.length - afterFix.length;
const percentSavings = Math.round((tokenSavings / beforeFix.length) * 100);
console.log(`Saved ${tokenSavings} characters (${percentSavings}% reduction)`);
console.log("Estimated token savings: ~" + Math.round(tokenSavings / 4) + " tokens");