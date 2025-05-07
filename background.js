// --- Configuration ---
const API_KEY = "scorpio1000p-62d0ce33-a280-23dd-13c9-246b29c7c7c8"; // Make sure this is your correct key
const API_URL = "https://api.nocaptchaai.com/createTask";
// const GET_RESULT_URL = "https://api.nocaptchaai.com/getTaskResult"; // Uncomment and use if polling is needed for CAPTCHA

// --- Listener for Messages from Content Scripts ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log("Background: Received message:", message);

    // --- Handle CAPTCHA Solving Request ---
    if (message.action === "solveCaptcha" && sender.tab) {
        console.log("Background: Received solveCaptcha request with data:", message.data);
        callNoCaptchaAPI(message.data)
            .then(solutionData => {
                console.log("Background: CAPTCHA API call successful, sending solution back:", solutionData);
                if (sender.tab.id) {
                    chrome.tabs.sendMessage(sender.tab.id, {
                        action: "clickMatchingImages",
                        indices: solutionData.indices,
                        originalIds: solutionData.originalIds
                    }).catch(err => console.error("Background: Error sending clickMatchingImages message:", err));
                } else {
                     console.error("Background: Sender tab ID missing for clickMatchingImages.");
                }
            })
            .catch(error => {
                console.error("Background: Error calling NoCaptchaAI API:", error);
                if (sender.tab.id) {
                    chrome.tabs.sendMessage(sender.tab.id, {
                        action: "captchaError",
                        error: error.message || "CAPTCHA API call failed"
                    }).catch(err => console.error("Background: Error sending captchaError message:", err));
                } else {
                     console.error("Background: Sender tab ID missing for captchaError.");
                }
            });
        return true; // Indicate asynchronous response for CAPTCHA solving
    }

    // --- Handle Kendo Dropdown Setting Request ---
    else if (message.action === "setDropdownValue" && sender.tab && sender.tab.id) {
        console.log("Background: Received setDropdownValue request:", message.data);
        const { elementId, value } = message.data;
        const tabId = sender.tab.id;

        if (!elementId || value === undefined) {
            console.error("Background: Missing elementId or value for setDropdownValue action.");
            sendResponse({ success: false, error: "Missing elementId or value" });
            return false; // Synchronous response (error)
        }

        // Execute the script in the page's main world context
        chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: setKendoDropdownValueInPage, // Function defined below
            args: [elementId, value],
            world: 'MAIN' // Execute in the page's context to access jQuery/Kendo
        })
        .then(injectionResults => {
            // Note: Results from executeScript in MAIN world are limited for security.
            // We usually just check if it executed without throwing an error.
            // The actual success/failure is logged by the injected function itself.
             if (chrome.runtime.lastError) {
                 console.error("Background: executeScript failed:", chrome.runtime.lastError.message);
                 sendResponse({ success: false, error: chrome.runtime.lastError.message });
             } else {
                 console.log("Background: executeScript for setDropdownValue initiated. Results (limited):", injectionResults);
                 // Assume initiation success if no error thrown
                 sendResponse({ success: true });
             }
        })
        .catch(error => {
            console.error("Background: Error executing setDropdownValue script:", error);
            sendResponse({ success: false, error: error.message || "Script execution failed" });
        });

        return true; // Indicate asynchronous response for dropdown setting
    }

    // --- Handle other messages or return false ---
    console.log("Background: Received unhandled message action:", message.action);
    return false; // Indicate synchronous handling for unhandled messages
});

/**
 * Function to be injected into the page context to set Kendo DropDownList value.
 * IMPORTANT: This function will run in the PAGE's context, not the background script's.
 * It needs to be self-contained or rely only on variables available in the page scope (like window.jQuery).
 * @param {string} elementId - The ID of the hidden input/select associated with the Kendo DropDownList.
 * @param {string} textToSelect - The visible text of the option to select.
 */
function setKendoDropdownValueInPage(elementId, textToSelect) {
    // This code runs in the target page's context (MAIN world)
    try {
        if (!window.jQuery) {
            console.error('Kendo Injector (Page Context): jQuery not found on page.');
            return { success: false, error: 'jQuery not found' };
        }
        const dropdown = window.jQuery('#' + elementId).data('kendoDropDownList');
        if (!dropdown) {
            console.error('Kendo Injector (Page Context): Kendo DropDownList not found for ID:', elementId);
            return { success: false, error: 'Kendo widget not found' };
        }
        const dataSource = dropdown.dataSource;
        const selectValue = () => {
            const data = dataSource.data();
            let valueFound = null;
            let textFound = null;
            console.log(`Kendo Injector (Page Context): Searching for "${textToSelect}" in #${elementId}. Options available:`, data.map(d => d.Name || d.text || d));

            for (let i = 0; i < data.length; i++) {
                const item = data[i];
                const itemName = item.Name || item.text;
                const itemValue = item.Id !== undefined ? item.Id :
                                  item.Value !== undefined ? item.Value :
                                  item.value !== undefined ? item.value :
                                  itemName;

                if (itemName && itemName.trim().toLowerCase() === textToSelect.trim().toLowerCase()) {
                    valueFound = itemValue;
                    textFound = itemName;
                    break;
                }
            }

            if (valueFound !== null) {
                console.log(`Kendo Injector (Page Context): Setting value for #${elementId} to:`, valueFound, `(matched text: "${textFound}")`);
                dropdown.value(valueFound);
                // Trigger change after a delay
                setTimeout(() => {
                    dropdown.trigger('change');
                    console.log(`Kendo Injector (Page Context): Triggered change for #${elementId}`);
                }, 150); // Slightly longer delay in page context might be safer
                 return { success: true, valueSet: valueFound };
            } else {
                console.warn(`Kendo Injector (Page Context): Could not find value for text "${textToSelect}" in #${elementId}.`);
                 return { success: false, error: `Option "${textToSelect}" not found` };
            }
        };

        if (dataSource.transport && typeof dataSource.transport.read === 'function' && !dataSource.data().length) {
             console.log(`Kendo Injector (Page Context): Data for #${elementId} not loaded, fetching...`);
             // Returning result from async fetch is tricky here. Log success/failure within selectValue.
             dataSource.fetch(selectValue);
             return { success: true, status: 'fetch initiated' }; // Indicate fetch started
        } else {
             console.log(`Kendo Injector (Page Context): Data for #${elementId} seems loaded or no fetch needed.`);
             return selectValue(); // Execute selection logic directly
        }

    } catch (err) {
        console.error(`Kendo Injector (Page Context): Error setting dropdown value for #${elementId}:`, err);
        return { success: false, error: err.message || 'Unknown error in page context' };
    }
}


/**
 * Calls the NoCaptchaAI API and processes the response.
 * @param {object} captchaData - Object containing targetNumber, base64Images, and imageIds.
 * @returns {Promise<object>} A promise that resolves with an object containing the indices of matching images and the originalIds array.
 */
async function callNoCaptchaAPI(captchaData) {
  const { targetNumber, base64Images, imageIds } = captchaData;

  // Basic validation
  if (!API_KEY || API_KEY === "YOUR_API_KEY") { // Check against placeholder
      throw new Error("API Key not configured in background.js.");
  }
  if (!targetNumber || !base64Images || base64Images.length === 0) {
      throw new Error("Missing target number or images for API call.");
  }
   // Expect exactly 9 images based on previous findings
  if (base64Images.length !== 9 || imageIds.length !== 9) {
       console.warn(`Background: Received ${base64Images.length} images and ${imageIds.length} IDs. Expected 9. Proceeding with received data.`);
       // throw new Error("Incorrect number of images/IDs received for CAPTCHA."); // Make it stricter if needed
  }


  // Construct the payload for the API
  const payload = {
    clientKey: API_KEY,
    task: {
      type: "ImageToTextTask",
      images: base64Images, // Should be exactly 9
      module: "morocco",
      numeric: true,
      case: false,
      maxLength: 3
    },
    languagePool: "en"
  };

  console.log("Background: Sending payload to NoCaptchaAI API (key omitted):", payload.task);

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      let errorText = response.statusText;
      try {
          const errorBody = await response.json();
          errorText = errorBody.message || JSON.stringify(errorBody);
      } catch (e) {
          try { errorText = await response.text() || errorText; }
          catch(readErr) { console.error("Background: Failed to read error response body:", readErr); }
      }
      throw new Error(`API request failed with status ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    console.log("Background: Received API Response:", result);

    if (result.errorId !== 0) {
      throw new Error(`NoCaptchaAI API Error ID: ${result.errorId} (Check API docs for details)`);
    }
    if (result.status !== "ready") {
      console.warn(`Background: API status is not 'ready', received: ${result.status}. Polling might be needed.`);
      throw new Error(`API status is not 'ready': ${result.status}. Task ID: ${result.taskId || 'N/A'}`);
    }
    if (!result.solution || !result.solution.text || !Array.isArray(result.solution.text)) {
        console.error("Background: Invalid or missing solution format in API response:", result.solution);
        throw new Error("Invalid solution format received from API.");
    }

    const recognizedTexts = result.solution.text;
    const matchingIndices = [];

    // Expect API to return array of same length as input images (9)
    if(recognizedTexts.length !== base64Images.length) {
        console.warn(`Background: API returned ${recognizedTexts.length} results, but ${base64Images.length} images were sent. Matching based on available results.`);
    }

    recognizedTexts.forEach((text, index) => {
      if (index < imageIds.length) { // Ensure we don't go out of bounds
          const recognizedTextTrimmed = String(text).trim();
          const targetNumberTrimmed = String(targetNumber).trim();
          if (recognizedTextTrimmed === targetNumberTrimmed) {
              console.log(`Background: Match found at index ${index} for number ${targetNumberTrimmed}`);
              matchingIndices.push(index); // Store the original index (0-8)
          }
      }
    });

    if(matchingIndices.length === 0) {
        console.log("Background: No matching images found for target number:", targetNumber);
    }

    // Return the indices and the original IDs array sent by content script
    return { indices: matchingIndices, originalIds: imageIds };

  } catch (error) {
    console.error("Background: Error during API call or processing:", error);
    throw error;
  }
}
