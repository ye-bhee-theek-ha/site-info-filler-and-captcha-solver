// --- Configuration ---
const API_KEY = "scorpio1000p-62d0ce33-a280-23dd-13c9-246b29c7c7c8"; 
const API_URL = "https://api.nocaptchaai.com/createTask";


// Listen for messages from content scripts (specifically the solveCaptcha action)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background: Received message from content script:", message, sender);
  // Ensure message is from a content script in a tab and has the expected action
  if (message.action === "solveCaptcha" && sender.tab) {
    console.log("Background: Received captcha data from content script:", message.data);

    // Call the API asynchronously
    callNoCaptchaAPI(message.data)
      .then(solutionData => { // Expecting { indices: [], originalIds: [] }
        console.log("Background: API call successful, sending solution data back:", solutionData);
        // Send the indices of images to click back to the content script that sent the message
        if (sender.tab.id) {
             chrome.tabs.sendMessage(sender.tab.id, {
                action: "clickMatchingImages",
                indices: solutionData.indices,
                originalIds: solutionData.originalIds // Pass back original IDs for clicking
             }).catch(err => console.error("Background: Error sending click message to tab:", sender.tab.id, err)); // Add catch for sendMessage
        } else {
             console.error("Background: Sender tab ID missing, cannot send click message back.");
        }
      })
      .catch(error => {
        console.error("Background: Error calling NoCaptchaAI API:", error);
        // Optionally send an error message back to the content script
        if (sender.tab.id) {
            chrome.tabs.sendMessage(sender.tab.id, {
                action: "captchaError",
                error: error.message || "API call failed"
            }).catch(err => console.error("Background: Error sending error message to tab:", sender.tab.id, err)); // Add catch for sendMessage
        } else {
             console.error("Background: Sender tab ID missing, cannot send error message back.");
        }
      });

    // Indicate that sendResponse will be called asynchronously (important!)
    return true;
  }
  // Handle other potential messages if needed
  // console.log("Background: Received unhandled message:", message);
  return false; // Indicate synchronous handling for other messages
});

/**
 * Calls the NoCaptchaAI API and processes the response.
 * (This function remains the same as in the previous captcha solver example)
 * @param {object} captchaData - Object containing targetNumber, base64Images, and imageIds.
 * @returns {Promise<object>} A promise that resolves with an object containing the indices of matching images and the originalIds array.
 */
async function callNoCaptchaAPI(captchaData) {
  const { targetNumber, base64Images, imageIds } = captchaData;

  // Basic validation
  if (!API_KEY || API_KEY === "YOUR_API_KEY") {
      throw new Error("API Key not configured in background.js.");
  }
  if (!targetNumber || !base64Images || base64Images.length === 0) {
      throw new Error("Missing target number or images for API call.");
  }
  if (base64Images.length !== imageIds.length) {
       console.warn("Background: Mismatch between number of images and image IDs.");
       // Decide if this is a critical error or can proceed
       // throw new Error("Mismatch between number of images and image IDs.");
  }


  // Construct the payload for the API
  const payload = {
    clientKey: API_KEY,
    task: {
      type: "ImageToTextTask",
      images: base64Images,
      module: "morocco", // Specific module for this captcha type
      numeric: true,     // Expect only numbers
      case: false,      // Case insensitive
      maxLength: 3     // Max length based on example (adjust if needed)
      // Add other parameters like minLength, comment, websiteURL if needed
    },
    languagePool: "en" // Optional
  };

  console.log("Background: Sending payload to NoCaptchaAI API (key omitted):", payload.task);

  try {
    // Make the API request using fetch
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json' // Explicitly accept JSON
      },
      body: JSON.stringify(payload)
    });

    // Check for HTTP errors (e.g., 404, 500)
    if (!response.ok) {
      let errorText = response.statusText;
      try {
          // Try to get more detailed error from response body
          const errorBody = await response.json();
          errorText = errorBody.message || JSON.stringify(errorBody);
      } catch (e) {
          // If response body is not JSON or empty
          try {
             errorText = await response.text() || errorText;
          } catch(readErr) {
             console.error("Background: Failed to read error response body:", readErr);
          }
      }
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    // Parse the JSON response
    const result = await response.json();
    console.log("Background: Received API Response:", result);

    // Check for API-specific errors indicated by errorId
    if (result.errorId !== 0) {
      // You might want to map error IDs to more descriptive messages if documentation provides them
      throw new Error(`NoCaptchaAI API Error ID: ${result.errorId} (Check API docs for details)`);
    }

    // Check if the task status is ready (as expected from the example)
    if (result.status !== "ready") {
      // If the API *can* return "processing", you'd need to implement polling here
      // using result.taskId and a separate getTaskResult endpoint.
      console.warn(`Background: API status is not 'ready', received: ${result.status}. Polling might be needed.`);
      throw new Error(`API status is not 'ready': ${result.status}. Task ID: ${result.taskId || 'N/A'}`);
    }

    // Validate the solution structure
    if (!result.solution || !result.solution.text || !Array.isArray(result.solution.text)) {
        console.error("Background: Invalid or missing solution format in API response:", result.solution);
        throw new Error("Invalid solution format received from API.");
    }

    // --- Match results ---
    const recognizedTexts = result.solution.text;
    const matchingIndices = [];

     // Defensive check for length mismatch
    if(recognizedTexts.length !== base64Images.length) {
        console.warn(`Background: API returned ${recognizedTexts.length} results, but ${base64Images.length} images were sent. Matching based on available results.`);
        // Consider how critical this is. For now, we proceed with the results we got.
    }

    // Iterate through the recognized texts (assuming 1:1 correspondence with input images)
    recognizedTexts.forEach((text, index) => {
      // Ensure we don't go out of bounds if lengths mismatch
      if (index < imageIds.length) {
          // Trim whitespace just in case
          const recognizedTextTrimmed = String(text).trim();
          const targetNumberTrimmed = String(targetNumber).trim();

          if (recognizedTextTrimmed === targetNumberTrimmed) {
              console.log(`Background: Match found at index ${index} for number ${targetNumberTrimmed}`);
              matchingIndices.push(index); // Store the *index* of the matching image
          }
      }
    });

    if(matchingIndices.length === 0) {
        console.log("Background: No matching images found for target number:", targetNumber);
    }

    // Return the indices and the original IDs array for the content script
    return { indices: matchingIndices, originalIds: imageIds };

  } catch (error) {
    // Log and re-throw errors for the calling function to handle
    console.error("Background: Error during API call or processing:", error);
    throw error; // Propagate the error back to the message listener
  }
}
