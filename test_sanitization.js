// Test the sanitization logic
function sanitizeToolResultForText(toolResultData) {
  if (typeof toolResultData !== 'object' || toolResultData === null) {
    return toolResultData;
  }

  // Create a shallow copy and remove imageData field if present
  const sanitized = { ...toolResultData };
  if (sanitized.hasOwnProperty('imageData')) {
    delete sanitized.imageData;
  }

  return sanitized;
}

// Test data that mimics PerformActionTool result
const testData = {
  imageData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==",
  xpath: "//button[@id='test']",
  pageChange: {
    hasChanges: true,
    summary: "Button clicked successfully"
  },
  visualCheck: "Action was successful"
};

console.log("Original data:", testData);
console.log("\nSanitized data:", sanitizeToolResultForText(testData));
console.log("\nOriginal imageData preserved:", testData.imageData !== undefined);
console.log("Sanitized imageData removed:", sanitizeToolResultForText(testData).imageData === undefined);