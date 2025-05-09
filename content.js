/**
 * Combined Content Script: Form Filler + Automatic CAPTCHA Solver
 */

console.log("Combined Extension: Content Script Loaded.");

// --- Hardcoded Credentials & Data (From Form Filler) ---
const hardcodedUsername = "scorpio1000p@gmail.com";
const hardcodedPassword = "Sd#Xy*jRrb7TJQV";
const appointmentLocation = "Karachi"; // Updated Location
const appointmentCategory = "Normal";
const appointmentVisaType = "National Visa";
const appointmentVisaSubType = "Study";

// --- State Management ---
const AUTOMATION_PAUSED_KEY = 'simpleFillerAutomationPaused';
const APPOINTMENT_URL_PATH = "/Global/Appointment/VisaType"; // Path to redirect to if paused
// *** List of known CAPTCHA page paths ***
const CAPTCHA_URL_PATHS = [
    '/Global/newcaptcha/logincaptcha',
    '/Global/Appointment/AppointmentCaptcha'
];
let captchaSolverInitiated = false; // Flag to prevent multiple triggers
let captchaCheckTimeout = null; // Timeout handle for debouncing observer calls

// --- Logging Helper ---
function log(message) {
    console.log(`Combined Extension: ${message}`);
}

// --- Helper Functions (isElementVisibleAndEnabled, findVisibleElementNearLabel, delay - From Form Filler) ---

function isElementVisibleAndEnabled(element) {
    if (!element) return false;
    if (element.disabled) {
        // log(`Element ${element.id || element.tagName} is disabled.`);
        return false;
    }

    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
        // log(`Element ${element.id || element.tagName} hidden by style (display, visibility, opacity).`);
        return false;
    }

    // Check offsetParent: if null, the element or an ancestor is display:none (generally true)
    // Elements with position:fixed or sticky might have null offsetParent but still be visible.
    if (element.offsetParent === null && style.position !== 'fixed' && style.position !== 'sticky') {
        // log(`Element ${element.id || element.tagName} has no offsetParent and is not fixed/sticky.`);
        return false;
    }

    const rect = element.getBoundingClientRect();
    // For form elements, zero dimensions usually mean not interactable.
    // For labels or images, check dimensions carefully.
    if (['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON', 'A', 'IMG', 'DIV', 'SPAN'].includes(element.tagName)) { // Added SPAN for Kendo wrapper
        if (rect.width < 1 || rect.height < 1) { // Use < 1 to account for potential subpixel rendering issues
            // log(`Element ${element.id || element.tagName} has zero or near-zero width or height.`);
            return false;
        }
    }


    // Check if element is within the viewport bounds (optional, can be too restrictive if scrolling is expected)
    /*
    const isInViewport = (
        rect.top < window.innerHeight &&
        rect.bottom >= 0 && // Element's bottom edge is below the top of the viewport
        rect.left < window.innerWidth &&
        rect.right >= 0 // Element's right edge is past the left of the viewport
    );
    if (!isInViewport) {
        // log(`Element ${element.id || element.tagName} is outside the viewport.`);
        return false;
    }
    */

    // Final check: walk up the DOM to see if any parent is display:none
    let parent = element.parentElement;
    while (parent && parent !== document.body) { // Stop at body
        const parentStyle = window.getComputedStyle(parent);
        if (parentStyle.display === 'none') {
            // log(`Element ${element.id || element.tagName} has a parent (${parent.id || parent.tagName}) with display:none.`);
            return false;
        }
        parent = parent.parentElement;
    }

    return true;
}


/**
 * Finds the interactable form element (input, select, textarea, or the hidden input/select within a Kendo dropdown)
 * that is associated with a visible label containing the given text.
 * Iterates through ALL labels, finds the parent container, checks container visibility,
 * then finds the associated element within that container and checks its visibility. Returns the first valid match.
 * @param {string} labelText - The text to search for within labels (case-insensitive, partial match).
 * @param {string} [elementType='input, select, textarea'] - CSS selector for the target element types.
 * @returns {HTMLElement|null} The interactable form element (potentially hidden if Kendo) or null if not found.
 */
function findVisibleElementNearLabel(labelText, elementType = 'input, select, textarea') {
    const labels = document.querySelectorAll(`label`); // Get all labels
    log(`findVisibleElementNearLabel: Searching for label containing "${labelText}" for element type "${elementType}". Found ${labels.length} labels total.`);
    let bestMatch = null;

    for (const label of labels) { // Use for...of which is fine here
        // Check if the label text matches first
        if (label.textContent.trim().toLowerCase().includes(labelText.toLowerCase())) {
            // Find the specific parent container (adjust selector if needed, e.g., based on class 'mb-3')
            const parentContainer = label.closest('div.mb-3'); // Assuming this container controls visibility
            if (!parentContainer) {
                // log(`Label "${label.textContent.trim()}" found, but no parent 'div.mb-3' found.`);
                continue; // Skip if structure doesn't match
            }

            // *** Check visibility of the PARENT container first ***
            if (isElementVisibleAndEnabled(parentContainer)) {
                // log(`Label "${label.textContent.trim()}" found in a VISIBLE parent container.`);
                // Then check the label itself (might be redundant if parent check is sufficient, but safe)
                if (isElementVisibleAndEnabled(label)) {
                    let finalElement = null;
                    let visibilityCheckElement = null;
                    const forId = label.getAttribute('for');

                    // Try finding the element via 'for' attribute OR relative search WITHIN the visible container
                    if (forId) {
                        const elementById = document.getElementById(forId);
                        if (elementById) {
                            const kendoWrapper = elementById.closest('span.k-dropdown[role="listbox"]');
                            if (kendoWrapper && (elementById.tagName === 'INPUT' || elementById.tagName === 'SELECT')) {
                                finalElement = elementById;
                                visibilityCheckElement = kendoWrapper;
                            } else if (elementById.matches && elementById.matches(elementType)) {
                                finalElement = elementById;
                                visibilityCheckElement = elementById;
                            }
                        }
                    }

                    // If 'for' didn't work, search relatively within the visible container
                    if (!finalElement) {
                        // Search for Kendo wrapper OR direct element type within the specific parent container
                        let foundRelative = parentContainer.querySelector('span.k-dropdown[role="listbox"], ' + elementType);
                        // Next sibling check might be less reliable
                        // if (!foundRelative && label.nextElementSibling && ...)

                        if (foundRelative) {
                            if (foundRelative.matches('span.k-dropdown[role="listbox"]')) {
                                const kendoInput = foundRelative.querySelector('input[data-role="dropdownlist"], select[data-role="dropdownlist"]');
                                if (kendoInput) {
                                    finalElement = kendoInput;
                                    visibilityCheckElement = foundRelative;
                                }
                            } else if (foundRelative.matches(elementType)) {
                                finalElement = foundRelative;
                                visibilityCheckElement = foundRelative;
                            }
                        }
                    }

                    // Final check: Is the target (or its wrapper) visible?
                    if (finalElement && visibilityCheckElement && isElementVisibleAndEnabled(visibilityCheckElement)) {
                        log(`Found VISIBLE candidate for label "${labelText}" (Actual Label: "${label.textContent.trim()}", Element ID: ${finalElement.id || 'N/A'}, Visibility Check on: ${visibilityCheckElement.id || visibilityCheckElement.tagName})`);
                        bestMatch = finalElement; // Assign the candidate
                        break; // *** Found the first fully visible match, stop searching ***
                    }
                } else {
                     // log(`Label "${label.textContent.trim()}" has visible parent, but label itself is hidden.`);
                }
            } else {
                 // log(`Label "${label.textContent.trim()}" found, but its parent container is hidden.`);
            }
        }
    } // End of label loop

    if (!bestMatch) {
        log(`Could not find a visible/enabled element of type [${elementType}] associated with label "${labelText}" after checking all potentials.`);
    } else {
        log(`Selected element for "${labelText}" has ID: ${bestMatch.id || 'N/A'}`);
    }
    return bestMatch; // Return the first valid match found, or null
}


function delay(ms) {
    log(`Waiting for ${ms}ms...`);
    return new Promise(resolve => setTimeout(resolve, ms));
}


// --- Kendo Interaction ---
// *** REMOVED executeInPageContext and setKendoDropdownValue ***
// *** These are now handled via background script messaging ***


// --- Popup Handling (From Form Filler) ---
function checkForAndClosePopups() {
    log("Checking for popups...");
    const modalSelectors = [
        '.modal.show', '.modal.in', '.ui-dialog:visible',
        '[role="dialog"][aria-hidden="false"]', '[role="dialog"]:not([aria-hidden="true"])',
        '.k-widget.k-window'
    ];
    const closeButtonSelectors = [
        '.modal.show .modal-footer button[data-bs-dismiss="modal"]', '.modal.show .modal-header button.btn-close',
        '.modal.in .modal-footer button[data-dismiss="modal"]', '.modal.in .modal-header button.close',
        '.ui-dialog .ui-dialog-buttonpane button:first-of-type', '.ui-dialog .ui-dialog-titlebar-close',
        '.k-window .k-window-actions .k-button-icon.k-i-close', 'button[aria-label*="Close"]',
        'button[aria-label*="Dismiss"]', 'button.close', 'button[data-bs-dismiss="modal"]',
        'button[data-dismiss="modal"]', '.modal-footer button:not([disabled]):first-of-type',
        '[role="dialog"] button:not([disabled]):first-of-type'
    ];

    let closedPopup = false;
    for (const modalSelector of modalSelectors) {
        try {
            const modals = document.querySelectorAll(modalSelector);
            modals.forEach(modal => {
                if (isElementVisibleAndEnabled(modal)) {
                    log(`Found potential popup matching selector: ${modalSelector}`);
                    for (const btnSelector of closeButtonSelectors) {
                        const closeButton = modal.querySelector(btnSelector);
                        if (closeButton && isElementVisibleAndEnabled(closeButton)) {
                            log(`Found close button "${closeButton.outerHTML.substring(0, 100)}..." in popup, clicking.`);
                            closeButton.click();
                            closedPopup = true;
                            return;
                        }
                    }
                    if (!closedPopup) log(`No standard close button found in popup: ${modalSelector}.`);
                }
            });
        } catch (e) {
            if (!(e instanceof DOMException)) log(`Error processing selector "${modalSelector}": ${e}`);
        }
        if (closedPopup) return true;
    }
    return closedPopup;
}


// --- CAPTCHA Solving Functions ---

function getCaptchaInstruction() {
    // *** Updated: Check if we are on a known CAPTCHA page first ***
    const currentPath = window.location.pathname;
    const isOnCaptchaPage = CAPTCHA_URL_PATHS.some(path => currentPath.includes(path));
    if (!isOnCaptchaPage) return null; // Don't search if not on a CAPTCHA page

    const instructionContainer = document.querySelector('.main-div-container > .row.no-gutters.text-center');
    if (!instructionContainer) {
        log("CAPTCHA: getCaptchaInstruction - Could not find instruction container.");
        return null;
    }

    const labels = Array.from(instructionContainer.querySelectorAll('div.box-label'));
    log(`CAPTCHA: getCaptchaInstruction - Found ${labels.length} potential labels in instruction container.`);

    let highestZIndex = -1;
    let targetLabelElement = null;

    for (const label of labels) {
        const parentContainer = label.closest('div.col-12');
        if (!parentContainer || !isElementVisibleAndEnabled(parentContainer)) {
            continue;
        }
        if (isElementVisibleAndEnabled(label)) {
            const style = window.getComputedStyle(label);
            const zIndex = parseInt(style.zIndex, 10);

            if (!isNaN(zIndex)) {
                if (zIndex > highestZIndex) {
                    highestZIndex = zIndex;
                    targetLabelElement = label;
                }
            } else if (targetLabelElement === null) {
                if (highestZIndex === -1) {
                    targetLabelElement = label;
                }
            }
        }
    }

    if (!targetLabelElement) {
        for (const label of labels) {
             const parentContainer = label.closest('div.col-12');
             if (parentContainer && isElementVisibleAndEnabled(parentContainer) && isElementVisibleAndEnabled(label)) {
                targetLabelElement = label;
                log(`CAPTCHA: Fallback - Found first visible instruction label (ID: ${label.id || 'no id'}) in visible parent container.`);
                break;
            }
        }
    }


    if (!targetLabelElement) {
        log("CAPTCHA: Could not find a suitable visible instruction label based on parent visibility, self-visibility, or z-index.");
        return null;
    }

    const visibleText = targetLabelElement.textContent.trim();
    log(`CAPTCHA: Selected instruction label (ID: ${targetLabelElement.id || 'no id'}, z-index: ${window.getComputedStyle(targetLabelElement).zIndex}): "${visibleText}"`);

    const match = visibleText.match(/number\s+(\d+)/i);
    if (match && match[1]) {
        const targetNumber = match[1];
        log("CAPTCHA: Extracted target number from selected instruction:", targetNumber);
        return targetNumber;
    } else {
        log("CAPTCHA: Could not extract number from selected instruction text:", visibleText);
        return null;
    }
}

function getCaptchaImagesData() {
    // *** Updated: Check if we are on a known CAPTCHA page first ***
    const currentPath = window.location.pathname;
    const isOnCaptchaPage = CAPTCHA_URL_PATHS.some(path => currentPath.includes(path));
    if (!isOnCaptchaPage) return null; // Don't search if not on a CAPTCHA page

    const gridContainer = document.querySelector('div.p-3.row');
    if (!gridContainer) {
        log("CAPTCHA: getCaptchaImagesData - Could not find the grid container (div.p-3.row).");
        return null;
    }

    const allImageElementsInGrid = Array.from(gridContainer.querySelectorAll('.col-4[id] img.captcha-img'));
    log(`CAPTCHA: getCaptchaImagesData - Found ${allImageElementsInGrid.length} potential images in grid container.`);

    const imagesData = { base64Images: [], imageIds: [] };
    let visibleAndExtractedCount = 0;

    for (const img of allImageElementsInGrid) {
        const parentDiv = img.closest('.col-4[id]');
        if (!parentDiv || !isElementVisibleAndEnabled(parentDiv)) {
            continue;
        }
        if (isElementVisibleAndEnabled(img)) {
            if (img.src && parentDiv.id && img.src.startsWith('data:image')) {
                const base64Part = img.src.split(',')[1];
                if (base64Part) {
                    imagesData.base64Images.push(base64Part);
                    imagesData.imageIds.push(parentDiv.id);
                    visibleAndExtractedCount++;
                } else {
                    log(`CAPTCHA WARN: Visible Image (ID: ${parentDiv.id}) has data URL but no Base64 part.`);
                }
            } else if (parentDiv.id) {
                 log(`CAPTCHA WARN: Visible Image (ID: ${parentDiv.id}) src is not a data URL or missing src/id. Src: ${img.src ? img.src.substring(0,30) : 'N/A'}`);
            }
        }
        if (visibleAndExtractedCount >= 9) {
            break;
        }
    }

    log(`CAPTCHA: Successfully extracted data for ${visibleAndExtractedCount} visible images from the grid.`);

    if (visibleAndExtractedCount !== 9) {
        log(`CAPTCHA ERROR: Extracted data for ${visibleAndExtractedCount} visible images. Expected exactly 9. Cannot reliably solve.`);
        return null;
    }

    return imagesData;
}

function clickCaptchaImageById(elementId) {
    const parentElement = document.getElementById(elementId);
    if (parentElement) {
        const imgElement = parentElement.querySelector('img.captcha-img');
        if (imgElement && isElementVisibleAndEnabled(imgElement)) {
            log("CAPTCHA: Clicking image inside element with ID:", elementId);
            const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
            imgElement.dispatchEvent(clickEvent);
            parentElement.style.outline = "3px solid orange";
            setTimeout(() => { parentElement.style.outline = ""; }, 500);
        } else if (imgElement) { log(`CAPTCHA WARN: Image element found in #${elementId} but not visible/enabled.`); }
        else { log(`CAPTCHA WARN: Could not find image element inside div with ID: ${elementId}`); }
    } else { log(`CAPTCHA ERROR: Could not find parent element to click with ID: ${elementId}`); }
}

function triggerCaptchaSolver() {
    log("CAPTCHA: triggerCaptchaSolver CALLED.");
    if (captchaSolverInitiated) {
        log("CAPTCHA: triggerCaptchaSolver - Solver already initiated. Skipping.");
        return;
    }
    log("CAPTCHA: triggerCaptchaSolver - Attempting to extract data...");
    const targetNumber = getCaptchaInstruction();
    const imagesDataResult = getCaptchaImagesData();
    log(`CAPTCHA: triggerCaptchaSolver - Fresh Extraction Results: targetNumber: ${targetNumber}, imagesDataResult: ${imagesDataResult ? imagesDataResult.base64Images.length + " images" : "null"}`);


    if (targetNumber && imagesDataResult && imagesDataResult.base64Images.length === 9) {
         const { base64Images, imageIds } = imagesDataResult;
         if (imageIds.length === 9) {
            log("CAPTCHA: triggerCaptchaSolver - Extracted data valid (9 images). Sending to background script...");
            captchaSolverInitiated = true;
            chrome.runtime.sendMessage({
                action: "solveCaptcha",
                data: { targetNumber, base64Images, imageIds }
            }, (response) => {
                if (chrome.runtime.lastError) {
                    log("CAPTCHA ERROR: Error sending message to background:", chrome.runtime.lastError.message);
                    alert(`CAPTCHA Solver Error: Could not communicate with background. ${chrome.runtime.lastError.message}`);
                    captchaSolverInitiated = false; // Reset flag on send error
                } else { log("CAPTCHA: Message sent to background script."); }
            });
        } else {
             log(`CAPTCHA ERROR: triggerCaptchaSolver - Mismatch/Insufficient count after extraction (Images: ${base64Images.length}, IDs: ${imageIds.length}). Expected 9. Solver not triggered.`);
             captchaSolverInitiated = false; // Reset flag
        }
    } else {
        log(`CAPTCHA: triggerCaptchaSolver - Failed to extract necessary data (targetNumber: ${targetNumber}, images: ${imagesDataResult ? imagesDataResult.base64Images.length : 'null'}). Conditions not met. Solver not triggered.`);
        captchaSolverInitiated = false; // Reset flag
    }
}


// --- Main Automation Logic (From Form Filler) ---
async function runAutomation() {
    const currentPath = window.location.pathname;
    log(`runAutomation: Current path: ${currentPath}`);

    const usernameFieldForCheck = findVisibleElementNearLabel("Email", "input");
    const passwordFieldForCheck = findVisibleElementNearLabel("Password", "input");
    const verifyButtonForCheck = document.querySelector('#btnVerify');
    const isOnEmailPage = usernameFieldForCheck && !passwordFieldForCheck && verifyButtonForCheck;

    // Clear pause flag only if truly on the initial email page
    if (isOnEmailPage) {
        log("Detected Email Page, clearing automation pause flag.");
        sessionStorage.removeItem(AUTOMATION_PAUSED_KEY);
    }

    // Check pause flag AFTER potentially clearing it
    // Note: The actual redirect logic if paused is now handled by initiateAutomation
    if (sessionStorage.getItem(AUTOMATION_PAUSED_KEY) === 'true') {
        log("Automation is paused for this session. No actions will be taken by runAutomation.");
        return;
    }

    // --- Proceed with automation checks if not paused ---

    // Check if on a known CAPTCHA page
    const isOnCaptchaPage = CAPTCHA_URL_PATHS.some(path => currentPath.includes(path));
    if (isOnCaptchaPage) {
        log("On CAPTCHA page. Form filling logic in runAutomation will be limited.");
        const passwordFieldOnCaptchaPage = findVisibleElementNearLabel("Password", "input");
        if (passwordFieldOnCaptchaPage && isElementVisibleAndEnabled(passwordFieldOnCaptchaPage) && passwordFieldOnCaptchaPage.value === "") {
            log("Password field found on CAPTCHA page, filling it.");
            passwordFieldOnCaptchaPage.value = hardcodedPassword;
            passwordFieldOnCaptchaPage.dispatchEvent(new Event('input', { bubbles: true }));
            passwordFieldOnCaptchaPage.dispatchEvent(new Event('change', { bubbles: true }));
            log("Password field on CAPTCHA page filled.");
        } else if (passwordFieldOnCaptchaPage && passwordFieldOnCaptchaPage.value !== "") {
            log("Password field on CAPTCHA page already has a value.");
        } else if (!passwordFieldOnCaptchaPage) {
            log("Password field not found on CAPTCHA page by runAutomation.");
        }
        // Let the observer handle the CAPTCHA trigger
        return;
    }

    log("Running automation check (not on CAPTCHA page)...");

    await delay(300); checkForAndClosePopups(); await delay(300);

    // Re-check elements for Email page logic
    const usernameField = findVisibleElementNearLabel("Email", "input");
    const verifyButton = document.querySelector('#btnVerify'); // Re-find verify button

    if (usernameField && isElementVisibleAndEnabled(usernameField) &&
        !findVisibleElementNearLabel("Password", "input") && // Ensure password field is NOT present
        isElementVisibleAndEnabled(verifyButton)) {
        // This block should now only run if the pause flag was cleared above
        log("On Email Page (and not paused).");
        await delay(200);
        if (usernameField.value !== hardcodedUsername) {
            usernameField.value = hardcodedUsername;
            usernameField.dispatchEvent(new Event('input', { bubbles: true }));
            usernameField.dispatchEvent(new Event('change', { bubbles: true }));
            log("Email field filled.");
        } else { log("Email field already filled."); }
        await delay(150);
        log("Clicking Verify button (from Email Page).");
        verifyButton.click();
        return; // Expecting navigation
    }

    // --- Stage 2: "Book New Appointment" Link ---
    log("Checking for 'Book New Appointment' link/button...");
    let bookLink = Array.from(document.querySelectorAll('a.nav-link'))
                           .find(a => a.textContent.trim().toLowerCase() === "book new appointment" && isElementVisibleAndEnabled(a));

    if (!bookLink) { // If nav-link not found or not visible, try the card button
        log("'a.nav-link' for booking not found or not visible. Checking for card button...");
        const cardContainer = document.querySelector('div.position-absolute.top-100.start-50.translate-middle');
        if (cardContainer && isElementVisibleAndEnabled(cardContainer)) {
            bookLink = cardContainer.querySelector('a.btn.btn-primary-soft'); // More specific selector
            if (bookLink && bookLink.textContent.trim().toLowerCase() === "book now" && isElementVisibleAndEnabled(bookLink)) {
                log("Found 'Book Now' card button.");
            } else {
                bookLink = null; // Reset if not the correct visible button
                log("'Book Now' card button not found or not visible/correct text.");
            }
        } else {
            log("Alternative booking card container not found or not visible.");
        }
    } else {
        log("Found 'Book New Appointment' in nav-link.");
    }

    if (bookLink) {
        log("Found a way to book appointment, clicking.");
        await delay(300);
        bookLink.click();
        return; // Expecting navigation
    }


    // --- Stage 3: Appointment Form ---
    log("Checking if on Appointment Form Page...");
    const locationInputCheck = findVisibleElementNearLabel("Location");
    const appointmentForLabelCheck = Array.from(document.querySelectorAll('label')).find(
        label => label.textContent.trim().startsWith("Appointment For") && isElementVisibleAndEnabled(label)
    );

    if (locationInputCheck && appointmentForLabelCheck) {
        log("On Appointment Form Page. Starting to fill...");
        await delay(1500); // *** Increased initial delay for appointment form ***

        log("Step 1: Selecting 'Individual' radio button...");
        const appointmentForDiv = appointmentForLabelCheck.closest('div.mb-3');
        let visibleIndividualRadio = null;
        if (appointmentForDiv) {
            const radios = appointmentForDiv.querySelectorAll('input[type="radio"][value="Individual"]');
            radios.forEach(radio => {
                const radioLabel = appointmentForDiv.querySelector(`label[for="${radio.id}"]`);
                if (isElementVisibleAndEnabled(radio) || (radioLabel && isElementVisibleAndEnabled(radioLabel))) {
                    visibleIndividualRadio = radio;
                }
            });
        }

        if (visibleIndividualRadio && !visibleIndividualRadio.checked) {
            log("Clicking 'Individual' radio button.");
            visibleIndividualRadio.click();
            visibleIndividualRadio.dispatchEvent(new Event('change', { bubbles: true }));
            await delay(750); checkForAndClosePopups(); await delay(750); // Increased delay
        } else if (visibleIndividualRadio && visibleIndividualRadio.checked) {
            log("'Individual' radio already checked.");
        } else {
            log("ERROR: Could not find visible 'Individual' radio button. Stopping form fill.");
            return;
        }

        log("Step 2: Filling Kendo Dropdowns...");

        // Function to handle setting a dropdown and waiting (using message passing)
        async function setDropdownAndWait(label, value) {
            const inputElement = findVisibleElementNearLabel(label);
            if (inputElement && inputElement.id) {
                log(`Requesting background to set ${label} dropdown (#${inputElement.id}) to "${value}"`);
                try {
                     const response = await chrome.runtime.sendMessage({
                         action: "setDropdownValue",
                         data: { elementId: inputElement.id, value: value }
                     });
                     log(`Response from background for setting ${label}:`, response);
                     if (!response || !response.success) {
                         if (response?.error?.includes("not found")) {
                             log(`WARN: Option "${value}" not found for ${label} dropdown (#${inputElement.id}).`);
                             alert(`Option "${value}" not found for ${label}. Stopping automation.`);
                             return false;
                         }
                         throw new Error(`Background script failed to set ${label}. Error: ${response?.error || 'Unknown error'}`);
                     }
                     const waitTime = label === "Visa Type" ? 3500 : 2000; // *** Increased delays ***
                     log(`Waiting ${waitTime}ms after setting ${label}...`);
                     await delay(waitTime);
                     checkForAndClosePopups();
                     await delay(500);
                     log(`Finished waiting after setting ${label}.`);
                     return true; // Indicate success
                } catch (error) {
                     log(`ERROR setting ${label} dropdown: ${error.message}`);
                     alert(`Error setting ${label}. Check console. CSP might be blocking interaction.`);
                     return false; // Indicate failure
                }
            } else {
                log(`ERROR: Could not find ${label} dropdown input. Stopping form fill.`);
                return false; // Indicate failure
            }
        }

        // Set dropdowns sequentially, stopping if one fails
        if (!await setDropdownAndWait("Location", appointmentLocation)) return;
        if (!await setDropdownAndWait("Category", appointmentCategory)) return;
        if (!await setDropdownAndWait("Visa Type", appointmentVisaType)) return;

        // Re-find Sub Type after waiting for Visa Type to be set
        const visaSubTypeInput = findVisibleElementNearLabel("Visa Sub Type");
         if (visaSubTypeInput && visaSubTypeInput.id) {
             log(`Requesting background to set Visa Sub Type dropdown (#${visaSubTypeInput.id}) to "${appointmentVisaSubType}"`);
             try {
                  const response = await chrome.runtime.sendMessage({
                      action: "setDropdownValue",
                      data: { elementId: visaSubTypeInput.id, value: appointmentVisaSubType }
                  });
                  log(`Response from background for setting Visa Sub Type:`, response);
                  if (!response || !response.success) {
                       if (response?.error?.includes("not found")) {
                           log(`WARN: Option "${appointmentVisaSubType}" not found for Visa Sub Type dropdown (#${visaSubTypeInput.id}). Continuing...`);
                       } else {
                           throw new Error(`Background script failed to set Visa Sub Type. Error: ${response?.error || 'Unknown error'}`);
                       }
                  }
                  await delay(1500); // Increased delay
                  checkForAndClosePopups();
                  await delay(500);
             } catch (error) {
                  log(`ERROR setting Visa Sub Type dropdown: ${error.message}`);
                  alert(`Error setting Visa Sub Type. Check console. CSP might be blocking interaction.`);
             }
         } else {
             log("WARN: Could not find Visa Sub Type dropdown input after setting Visa Type. Continuing...");
         }


        log("Step 3: Clicking Submit button...");
        await delay(500);
        const submitButton = document.querySelector('#btnSubmit');
        if (submitButton && isElementVisibleAndEnabled(submitButton)) {
            log("Found appointment Submit button, clicking.");
            submitButton.click();
            log("Setting automation paused flag.");
            sessionStorage.setItem(AUTOMATION_PAUSED_KEY, 'true');
        } else {
            log("Appointment Submit button (#btnSubmit) not found or not interactable.");
        }
        return; // End of appointment form stage
    }
    log("No specific form stage detected by runAutomation. Observer will watch for CAPTCHA if on CAPTCHA page.");
}

// --- Message Listener (for results from background.js) ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "clickMatchingImages") {
        log("CAPTCHA: Received indices to click from background:", message.indices);
        log("CAPTCHA: Original element IDs:", message.originalIds);
        if (message.indices && message.originalIds && Array.isArray(message.indices) && Array.isArray(message.originalIds)) {
            if (message.indices.length > 0) {
                if (message.originalIds.length === 9) {
                    message.indices.forEach((originalImageIndex, clickOrderIndex) => {
                         if (originalImageIndex >= 0 && originalImageIndex < message.originalIds.length) {
                            const elementIdToClick = message.originalIds[originalImageIndex];
                            if(elementIdToClick) {
                                setTimeout(() => clickCaptchaImageById(elementIdToClick), clickOrderIndex * 200);
                            } else { log(`CAPTCHA ERROR: Null or undefined element ID found at index ${originalImageIndex}`); }
                        } else { log(`CAPTCHA ERROR: Invalid index ${originalImageIndex} received from background.`); }
                    });
                    log("CAPTCHA: Finished attempting to click matching images.");

                    setTimeout(() => {
                        log("CAPTCHA: Attempting to find and click final submit button after selection...");
                        const finalSubmitButtonSelectors = [
                             '#btnCaptchaVerify',
                             'button[type="submit"]',
                             'button.btn-success',
                             'button.btn-primary',
                        ];
                        let finalSubmitButton = null;
                        for (const selector of finalSubmitButtonSelectors) {
                             try {
                                  finalSubmitButton = document.querySelector(selector);
                                  if (finalSubmitButton && isElementVisibleAndEnabled(finalSubmitButton)) {
                                       log(`CAPTCHA: Found potential final submit button using selector: ${selector}`);
                                       break;
                                  } else { finalSubmitButton = null; }
                             } catch (e) { finalSubmitButton = null; }
                        }
                        if (!finalSubmitButton) {
                            const buttonTexts = ["submit", "verify", "continue", "login"];
                            for (const text of buttonTexts) {
                                finalSubmitButton = Array.from(document.querySelectorAll('button')).find(btn =>
                                    btn.textContent.trim().toLowerCase().includes(text) && isElementVisibleAndEnabled(btn)
                                );
                                if (finalSubmitButton) {
                                    log(`CAPTCHA: Found final submit button by text: "${text}"`);
                                    break;
                                }
                            }
                        }

                        if (finalSubmitButton) {
                            log("CAPTCHA: Clicking final submit button:", finalSubmitButton);
                            finalSubmitButton.click();
                            log("Setting automation paused flag after CAPTCHA submission.");
                            sessionStorage.setItem(AUTOMATION_PAUSED_KEY, 'true');
                        } else {
                            log("CAPTCHA: Could not find or click the final submit button after CAPTCHA selection. Please check selectors or ensure it's visible/enabled.");
                            captchaSolverInitiated = false; // Reset flag to allow retry if submit fails
                        }
                    }, message.indices.length * 200 + 750);

                } else {
                     log(`CAPTCHA ERROR: Received originalIds array with length ${message.originalIds.length}, expected 9.`);
                     captchaSolverInitiated = false; // Reset flag
                }
            } else {
                log("CAPTCHA: No matching image indices received from background.");
                alert("CAPTCHA Solver: No matching images found by the API. Please solve manually.");
                captchaSolverInitiated = false; // Reset flag
            }
        } else {
            log("CAPTCHA ERROR: Invalid 'clickMatchingImages' message format received:", message);
            captchaSolverInitiated = false; // Reset flag
        }
    } else if (message.action === "captchaError") {
        log("CAPTCHA ERROR: Received error from background script:", message.error);
        alert(`CAPTCHA Solver Error: ${message.error}. Please solve manually.`);
        captchaSolverInitiated = false; // Reset flag on error
    }
    // Indicate if the listener will respond asynchronously (only needed if using sendResponse after async work)
    // Return true if you might call sendResponse later, false otherwise.
    return false; // We are not using sendResponse asynchronously here.
});


// --- Function to check for CAPTCHA and trigger solver (can be called initially and by observer) ---
function attemptCaptchaDetectionAndSolve() {
    log("CAPTCHA: attemptCaptchaDetectionAndSolve CALLED.");
    // *** Updated URL Check ***
    const currentPath = window.location.pathname;
    const isOnCaptchaPage = CAPTCHA_URL_PATHS.some(path => currentPath.includes(path));

    if (!isOnCaptchaPage) {
        if (captchaSolverInitiated) {
            log("CAPTCHA: Navigated away from CAPTCHA page during an attempt, resetting solver flag.");
            captchaSolverInitiated = false;
        }
        return; // Not on a CAPTCHA page
    }

    if (captchaSolverInitiated) {
        log("CAPTCHA: Solver already initiated, attempt skipped.");
        return;
    }

    const captchaInstructionText = getCaptchaInstruction();
    const visibleImageData = getCaptchaImagesData();

    log(`CAPTCHA: attemptCaptchaDetectionAndSolve - Visible Images Data: ${visibleImageData ? visibleImageData.base64Images.length : 'null'}, Instruction text: "${captchaInstructionText}"`);

    if (visibleImageData && visibleImageData.base64Images.length === 9 && captchaInstructionText) {
        log('CAPTCHA: Conditions MET for solving - Exactly 9 visible images and a valid visible instruction found.');
        triggerCaptchaSolver();
    } else {
        log(`CAPTCHA: Conditions NOT MET for solving in attemptCaptchaDetectionAndSolve. Visible Images Data: ${visibleImageData ? visibleImageData.base64Images.length : 'null'}, Instruction: ${captchaInstructionText}`);
    }
}


// --- MutationObserver to Detect CAPTCHA Appearance ---
const observerCallback = (mutationsList, observer) => {
    // log("CAPTCHA Observer: Mutation detected."); // Can be very noisy

    // *** Updated URL Check ***
    const currentPath = window.location.pathname;
    const isOnCaptchaPage = CAPTCHA_URL_PATHS.some(path => currentPath.includes(path));

    if (!isOnCaptchaPage) {
        if (captchaSolverInitiated) {
            log("CAPTCHA Observer: Navigated away from CAPTCHA page, resetting solver flag.");
            captchaSolverInitiated = false;
        }
        return; // Not on a CAPTCHA page
    }

    if (captchaSolverInitiated) {
        // log("CAPTCHA Observer: Solver already initiated, observer waiting for next cycle if needed.");
        return;
    }

    clearTimeout(captchaCheckTimeout);
    captchaCheckTimeout = setTimeout(() => {
        log('CAPTCHA Observer: Debounce timer expired, calling attemptCaptchaDetectionAndSolve.');
        attemptCaptchaDetectionAndSolve();
    }, 1000); // 1 second debounce
};

const observer = new MutationObserver(observerCallback);
observer.observe(document.body, { childList: true, subtree: true });
log("MutationObserver set up to watch for CAPTCHA elements.");

// --- Function to check pause state and redirect ---
async function checkAndHandlePauseStateContentScript() {
    log("Checking pause state in content script...");
    if (sessionStorage.getItem(AUTOMATION_PAUSED_KEY) === 'true') {
        log(`Automation is paused. Waiting 5 seconds before redirecting to ${APPOINTMENT_URL_PATH}...`);
        sessionStorage.removeItem(AUTOMATION_PAUSED_KEY); // Clear flag immediately
        log(`Pause flag "${AUTOMATION_PAUSED_KEY}" removed.`);
        await delay(5000); // Wait 5 seconds
        // *** Add check: Only redirect if NOT already on the target page ***
        if (!window.location.pathname.includes(APPOINTMENT_URL_PATH)) {
            log(`Redirecting now to ${APPOINTMENT_URL_PATH}.`);
            window.location.href = APPOINTMENT_URL_PATH; // Redirect
        } else {
            log(`Already on target page (${APPOINTMENT_URL_PATH}), skipping redirect.`);
        }
        return true; // Indicate that it was paused and handled
    } else {
        log("Automation is not paused.");
        return false; // Indicate it was not paused
    }
}


// --- Initial Run & Initial CAPTCHA Check ---
async function initiateAutomation() {
    log("Initiating automation sequence...");
    // Check pause state directly in content script first
    const wasPaused = await checkAndHandlePauseStateContentScript();

    if (!wasPaused) {
        // If not paused, proceed with normal automation flow after a delay
        log("Proceeding with automation.");
        await delay(1500); // Wait a bit before starting
        runAutomation();
        // *** REMOVED initial CAPTCHA check here - let observer handle it ***
        // The observer will call attemptCaptchaDetectionAndSolve if/when needed on the correct page
    } else {
        log("Automation was paused, redirection may have occurred or was skipped. If not redirected, runAutomation will now proceed.");
         // If redirection was skipped because we were already on the appointment page,
         // we still need to run the automation logic for that page.
         if (window.location.pathname.includes(APPOINTMENT_URL_PATH)) {
             await delay(500); // Short delay after clearing flag
             runAutomation();
         }
    }
}

// Call the function that starts the process
initiateAutomation();
