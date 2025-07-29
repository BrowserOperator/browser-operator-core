// Test the enhanced sanitization logic that removes success fields
function sanitizeToolResultForText(toolResultData) {
  if (typeof toolResultData !== 'object' || toolResultData === null) {
    return toolResultData;
  }

  // Create a shallow copy
  const sanitized = { ...toolResultData };
  
  // Remove fields that shouldn't be sent to LLM
  const fieldsToRemove = [
    'imageData',    // Prevents token waste from base64 strings
    'success',      // LLM should infer success from error presence
    'dataUrl',      // Legacy image field if any
  ];

  fieldsToRemove.forEach(field => {
    if (sanitized.hasOwnProperty(field)) {
      delete sanitized[field];
    }
  });

  return sanitized;
}

// Test case 1: Tool result with success field
console.log("=== TEST 1: Tool Result with Success Field ===");
const toolResult1 = {
  success: true,
  message: "Successfully navigated to the page",
  url: "https://example.com",
  metadata: { title: "Example Page" }
};

console.log("Original:", JSON.stringify(toolResult1, null, 2));
console.log("Sanitized:", JSON.stringify(sanitizeToolResultForText(toolResult1), null, 2));
console.log("Success field removed:", !sanitizeToolResultForText(toolResult1).hasOwnProperty('success'));

// Test case 2: Tool result with error (no success field)
console.log("\n=== TEST 2: Error Result ===");
const toolResult2 = {
  error: "Failed to navigate: Network error"
};

console.log("Original:", JSON.stringify(toolResult2, null, 2));
console.log("Sanitized:", JSON.stringify(sanitizeToolResultForText(toolResult2), null, 2));
console.log("Error preserved:", sanitizeToolResultForText(toolResult2).hasOwnProperty('error'));

// Test case 3: Tool result with imageData and success
console.log("\n=== TEST 3: Result with ImageData and Success ===");
const toolResult3 = {
  success: true,
  imageData: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB...",
  message: "Screenshot captured",
  xpath: "//button[@id='submit']",
  visualCheck: "Button was clicked successfully"
};

console.log("Original keys:", Object.keys(toolResult3));
console.log("Sanitized keys:", Object.keys(sanitizeToolResultForText(toolResult3)));
console.log("Both success and imageData removed:", 
  !sanitizeToolResultForText(toolResult3).hasOwnProperty('success') && 
  !sanitizeToolResultForText(toolResult3).hasOwnProperty('imageData'));

// Test case 4: Complex nested result
console.log("\n=== TEST 4: Complex Tool Result ===");
const toolResult4 = {
  success: false,
  error: "Action failed",
  data: {
    attempts: 3,
    lastError: "Element not found"
  },
  metadata: {
    timestamp: Date.now(),
    tool: "perform_action"
  }
};

const sanitized4 = sanitizeToolResultForText(toolResult4);
console.log("Original:", JSON.stringify(toolResult4, null, 2));
console.log("Sanitized:", JSON.stringify(sanitized4, null, 2));
console.log("Success removed, error and data preserved:", 
  !sanitized4.hasOwnProperty('success') && 
  sanitized4.hasOwnProperty('error') &&
  sanitized4.hasOwnProperty('data'));

// Test case 5: String result (non-object)
console.log("\n=== TEST 5: String Result ===");
const toolResult5 = "Simple string result";
console.log("Original:", toolResult5);
console.log("Sanitized:", sanitizeToolResultForText(toolResult5));
console.log("String unchanged:", toolResult5 === sanitizeToolResultForText(toolResult5));

// Test case 6: Legacy dataUrl field
console.log("\n=== TEST 6: Legacy dataUrl Field ===");
const toolResult6 = {
  success: true,
  dataUrl: "data:image/png;base64,oldformat...",
  message: "Legacy screenshot format"
};

console.log("Original keys:", Object.keys(toolResult6));
console.log("Sanitized keys:", Object.keys(sanitizeToolResultForText(toolResult6)));
console.log("Both success and dataUrl removed:", 
  !sanitizeToolResultForText(toolResult6).hasOwnProperty('success') && 
  !sanitizeToolResultForText(toolResult6).hasOwnProperty('dataUrl'));

console.log("\n=== SUMMARY ===");
console.log("✅ Success fields are removed from tool results sent to LLM");
console.log("✅ Error fields are preserved for LLM to understand failures");
console.log("✅ Image data fields are removed to save tokens");
console.log("✅ Other data fields are preserved");
console.log("✅ Non-object results pass through unchanged");