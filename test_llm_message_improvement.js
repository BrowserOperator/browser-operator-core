// Demonstrates the improvement in LLM messages after sanitization enhancements
function sanitizeToolResultForText(toolResultData) {
  if (typeof toolResultData !== 'object' || toolResultData === null) {
    return toolResultData;
  }
  const sanitized = { ...toolResultData };
  const fieldsToRemove = ['imageData', 'success', 'dataUrl'];
  fieldsToRemove.forEach(field => {
    if (sanitized.hasOwnProperty(field)) {
      delete sanitized[field];
    }
  });
  return sanitized;
}

// Example: What a typical tool result looks like
const exampleToolResults = [
  {
    name: "NavigationTool",
    result: {
      success: true,
      url: "https://github.com/anthropics/claude-code",
      message: "Successfully navigated to https://github.com/anthropics/claude-code",
      metadata: { title: "GitHub - anthropics/claude-code" }
    }
  },
  {
    name: "PerformActionTool",
    result: {
      imageData: "data:image/png;base64," + "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB...".repeat(30),
      xpath: "//button[@class='btn-primary']",
      pageChange: {
        hasChanges: true,
        summary: "Button clicked, form submitted"
      },
      visualCheck: "Successfully clicked submit button"
    }
  },
  {
    name: "BookmarkStoreTool",
    result: {
      success: true,
      id: "bookmark_123",
      title: "Important Documentation",
      url: "https://docs.example.com",
      message: "Bookmark saved successfully"
    }
  },
  {
    name: "FailedAction",
    result: {
      success: false,
      error: "Element not found: //button[@id='nonexistent']"
    }
  }
];

console.log("=== BEFORE SANITIZATION (What LLM used to receive) ===\n");
exampleToolResults.forEach(({name, result}) => {
  console.log(`${name}:`);
  console.log(JSON.stringify(result, null, 2));
  console.log(`Character count: ${JSON.stringify(result).length}`);
  console.log('---');
});

console.log("\n=== AFTER SANITIZATION (What LLM now receives) ===\n");
exampleToolResults.forEach(({name, result}) => {
  const sanitized = sanitizeToolResultForText(result);
  console.log(`${name}:`);
  console.log(JSON.stringify(sanitized, null, 2));
  console.log(`Character count: ${JSON.stringify(sanitized).length}`);
  console.log('---');
});

console.log("\n=== KEY IMPROVEMENTS ===");
console.log("1. ✅ No redundant success flags - LLM infers from error presence");
console.log("2. ✅ No base64 image data in text - saves thousands of tokens");
console.log("3. ✅ Cleaner, more focused information for LLM decision making");
console.log("4. ✅ Error messages still preserved for failure cases");

// Calculate token savings
const totalBefore = exampleToolResults.reduce((sum, {result}) => sum + JSON.stringify(result).length, 0);
const totalAfter = exampleToolResults.reduce((sum, {result}) => sum + JSON.stringify(sanitizeToolResultForText(result)).length, 0);
const savings = totalBefore - totalAfter;
const percentSaved = Math.round((savings / totalBefore) * 100);

console.log(`\n=== TOKEN SAVINGS ===`);
console.log(`Total characters before: ${totalBefore}`);
console.log(`Total characters after: ${totalAfter}`);
console.log(`Characters saved: ${savings} (${percentSaved}% reduction)`);
console.log(`Estimated tokens saved: ~${Math.round(savings / 4)} tokens`);