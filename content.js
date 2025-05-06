// --- Hardcoded Credentials & Data ---
const hardcodedUsername = "scorpio1000p@gmail.com";
const hardcodedPassword = "Sd#Xy*jRrb7TJQV";
const appointmentLocation = "Faisalabad";
const appointmentCategory = "Normal";
const appointmentVisaType = "National Visa";
const appointmentVisaSubType = "Study";

// --- State Management ---
const AUTOMATION_PAUSED_KEY = 'simpleFillerAutomationPaused';

// --- Helper Functions ---

function log(message) {
    console.log(`Simple Filler: ${message}`);
}

function isElementVisibleAndEnabled(element) {
    if (!element) return false;
    if (element.disabled) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0 || element.offsetWidth === 0 || element.offsetHeight === 0) {
        return false;
    }
    let parent = element.parentElement;
    while (parent) {
        const parentStyle = window.getComputedStyle(parent);
        if (parentStyle.display === 'none' || parentStyle.visibility === 'hidden') {
            return false;
        }
        parent = parent.parentElement;
    }
    return true;
}

function findVisibleElementNearLabel(labelText, elementType = 'input, select, textarea') {
    const labels = document.querySelectorAll('label');
    let potentialElements = [];

    labels.forEach(label => {
        // Check if the label itself is visible before proceeding
        if (!isElementVisibleAndEnabled(label)) {
            return; // Skip hidden labels
        }

        if (label.textContent.trim().toLowerCase().includes(labelText.toLowerCase())) {
            let associatedElement = null;
            const elementId = label.getAttribute('for');
            if (elementId) {
                associatedElement = document.getElementById(elementId);
            }
            if (!associatedElement) {
                const parent = label.closest('div, p, span');
                if (parent) {
                    // Find potential elements including the Kendo wrapper span
                    associatedElement = parent.querySelector(elementType + ', span.k-dropdown');
                }
            }
             if (!associatedElement && label.nextElementSibling && (elementType.toUpperCase().includes(label.nextElementSibling.tagName) || label.nextElementSibling.classList.contains('k-dropdown'))) {
                associatedElement = label.nextElementSibling;
            }

            // If we found a Kendo wrapper, get the actual hidden input for the ID, but keep the wrapper for visibility checks later
            if (associatedElement && associatedElement.classList && associatedElement.classList.contains('k-dropdown')) {
                 const kendoInput = associatedElement.querySelector('input[data-role="dropdownlist"]');
                 if (kendoInput) {
                     // Store both wrapper and input if needed, or just the input if only ID is needed later
                     potentialElements.push({ wrapper: associatedElement, input: kendoInput });
                     return; // Skip adding the wrapper alone
                 }
            }

            if (associatedElement) {
                 // Store non-kendo elements directly
                potentialElements.push({ input: associatedElement });
            }
        }
    });

    // Iterate through potential elements and check visibility
    for (const potential of potentialElements) {
        let elementToCheckVisibility = potential.wrapper || potential.input; // Check wrapper first if available
        let elementToReturn = potential.input; // Always return the actual input/select

        if (isElementVisibleAndEnabled(elementToCheckVisibility)) {
            log(`Found visible/enabled element for label "${labelText}".`);
            return elementToReturn;
        }
    }

    log(`Could not find a visible/enabled element associated with label "${labelText}".`);
    return null;
}


function executeInPageContext(functionToExecute, ...args) {
    const script = document.createElement('script');
    const argsString = args.map(arg => JSON.stringify(arg)).join(',');
    // Ensure the function is properly stringified and invoked
    script.textContent = `try { (${functionToExecute.toString()})(${argsString}); } catch(e) { console.error('Error in page context execution for ${functionToExecute.name}:', e); }`;
    (document.head || document.documentElement).appendChild(script);
    script.remove(); // Clean up the script tag
    log(`Executed function in page context: ${functionToExecute.name}`);
}


// --- Kendo Interaction (to be run in page context) ---
function setKendoDropdownValue(elementId, textToSelect) {
    // This function runs in the page's context, so it can use page's jQuery ($) and Kendo methods
    try {
        const dropdown = window.jQuery('#' + elementId).data('kendoDropDownList'); // Ensure jQuery is accessed via window
        if (!dropdown) {
            console.error('Kendo Injector: Kendo DropDownList not found for ID:', elementId);
            return false; // Indicate failure
        }
        const dataSource = dropdown.dataSource;
        // Ensure data is loaded before searching (might be async)
        dataSource.fetch(() => {
            const data = dataSource.data();
            let valueFound = null;
            console.log(`Kendo Injector: Searching for "${textToSelect}" in #${elementId}. Options available:`, data.map(d => d.Name || d.text));

            for (let i = 0; i < data.length; i++) {
                const itemName = data[i].Name || data[i].text; // Common text fields
                const itemValue = data[i].Id !== undefined ? data[i].Id : data[i].Value !== undefined ? data[i].Value : data[i].value; // Common value fields

                if (itemName && itemName.trim().toLowerCase() === textToSelect.trim().toLowerCase()) {
                    valueFound = itemValue;
                    break;
                }
            }

            if (valueFound !== null) {
                console.log(`Kendo Injector: Setting value for #${elementId} to:`, valueFound, `(based on text: ${textToSelect})`);
                dropdown.value(valueFound);
                // IMPORTANT: Trigger Kendo's change event after a slight delay to ensure UI updates
                setTimeout(() => {
                    dropdown.trigger('change');
                    console.log(`Kendo Injector: Triggered change for #${elementId}`);
                }, 50); // Small delay before triggering change
                // Note: Returning true here might be too early if the change event is critical for subsequent steps
            } else {
                 console.warn(`Kendo Injector: Could not find value for text "${textToSelect}" in #${elementId}.`);
                 // Optionally trigger change even if value not found, in case '--Select--' needs clearing?
                 // dropdown.trigger('change');
            }
        });
        return true; // Indicate the process was initiated (fetch might be async)

    } catch (err) {
        console.error(`Kendo Injector: Error setting dropdown value for #${elementId}:`, err);
        return false; // Indicate failure
    }
}

// --- Popup Handling ---
function checkForAndClosePopups() {
    log("Checking for popups...");
     // *** CORRECTED SELECTORS *** Remove :visible pseudo-class
    const modalSelectors = ['.modal.show', '.ui-dialog', '[role="dialog"][aria-hidden="false"]'];
    const closeButtonSelectors = [
        'button[aria-label*="Close"]', // Common accessibility pattern
        'button.close', // Common Bootstrap pattern
        '.modal-header button[data-bs-dismiss="modal"]', // Bootstrap 5
        '.modal-footer button:not([disabled]):first-of-type', // Often OK/Confirm/Close
        '.ui-dialog-buttonpane button:first-of-type', // jQuery UI Dialog
        '[role="dialog"] button:not([disabled]):first-of-type' // Generic fallback
    ];

    let closedPopup = false;
    for (const modalSelector of modalSelectors) {
        try {
            const modals = document.querySelectorAll(modalSelector);
            modals.forEach(modal => {
                // Check visibility *after* finding the element
                if (isElementVisibleAndEnabled(modal)) {
                    log(`Found potential popup matching selector: ${modalSelector}`);
                    for (const btnSelector of closeButtonSelectors) {
                        const closeButton = modal.querySelector(btnSelector);
                        if (closeButton && isElementVisibleAndEnabled(closeButton)) {
                            log(`Found close button "${closeButton.textContent.trim() || btnSelector}" in popup, clicking.`);
                            closeButton.click();
                            closedPopup = true;
                            return; // Stop searching for buttons in this modal
                        }
                    }
                     if (!closedPopup) {
                        log(`No standard close button found in popup: ${modalSelector}. Check custom buttons if needed.`);
                     }
                }
            });
        } catch (e) {
            log(`Error processing selector "${modalSelector}": ${e}`); // Log errors from querySelectorAll
        }
        if (closedPopup) return true; // Stop searching for modals if we closed one
    }
    if (!closedPopup) {
        log("No known popups found or closed.");
    }
    return closedPopup;
}


// --- Async Helper ---
function delay(ms) {
    log(`Waiting for ${ms}ms...`);
    return new Promise(resolve => setTimeout(resolve, ms));
}

// --- Main Automation Logic ---
async function runAutomation() {
    log("Running automation check...");

    if (sessionStorage.getItem(AUTOMATION_PAUSED_KEY) === 'true') {
        log("Automation is paused for this session.");
        return;
    }

    await delay(300);
    checkForAndClosePopups();
    await delay(300);

    // --- Stage 1: Login Fields ---
    const usernameField = findVisibleElementNearLabel("Email");
    const passwordField = findVisibleElementNearLabel("Password");
    const verifyButton = document.querySelector('#btnVerify'); // Assuming this ID is stable

    if (usernameField && !passwordField && isElementVisibleAndEnabled(verifyButton)) {
        log("On Email Page.");
        await delay(200);
        usernameField.value = hardcodedUsername;
        usernameField.dispatchEvent(new Event('input', { bubbles: true }));
        usernameField.dispatchEvent(new Event('change', { bubbles: true }));
        log("Email field filled.");
        await delay(150);
        log("Clicking Verify button.");
        verifyButton.click();
        return;
    }

    if (passwordField && !usernameField) {
        log("On Password Page.");
        await delay(200);
        passwordField.value = hardcodedPassword;
        passwordField.dispatchEvent(new Event('input', { bubbles: true }));
        passwordField.dispatchEvent(new Event('change', { bubbles: true }));
        log("Password field filled.");
        await delay(150);
        // Attempt to find and click the final submit button on the password page
        const loginButton = Array.from(document.querySelectorAll('button[type="submit"]')).find(btn => isElementVisibleAndEnabled(btn));
        if (loginButton) {
            log("Found submit button on password page, clicking.");
            loginButton.click();
        } else {
            log("Could not find visible submit button on password page.");
        }
        return;
    }

    // --- Stage 2: "Book New Appointment" Link ---
    const bookLink = Array.from(document.querySelectorAll('a.nav-link'))
                         .find(a => a.textContent.trim() === "Book New Appointment" && isElementVisibleAndEnabled(a));
    if (bookLink) {
        log("Found 'Book New Appointment' link, clicking.");
        await delay(300);
        bookLink.click();
        return;
    }

    // --- Stage 3: Appointment Form ---
    const appointmentForLabel = Array.from(document.querySelectorAll('label')).find(
        label => label.textContent.trim().startsWith("Appointment For") && isElementVisibleAndEnabled(label)
    );

    if (appointmentForLabel) {
        log("On Appointment Form Page.");
        await delay(1000); // Wait for form elements to likely load

        log("Filling appointment form...");

        // 1. Select Radio Button ("Individual")
        const appointmentForDiv = appointmentForLabel.closest('div.mb-3'); // Find parent container more reliably
        let visibleIndividualRadio = null;
        if (appointmentForDiv) {
            const radios = appointmentForDiv.querySelectorAll('input[type="radio"][value="Individual"]');
            radios.forEach(radio => {
                // Also check the label associated with the radio for visibility
                 const radioLabel = document.querySelector(`label[for="${radio.id}"]`);
                if (isElementVisibleAndEnabled(radio) || (radioLabel && isElementVisibleAndEnabled(radioLabel))) {
                    visibleIndividualRadio = radio;
                }
            });
        }

        if (visibleIndividualRadio && !visibleIndividualRadio.checked) {
            log("Clicking 'Individual' radio button.");
            visibleIndividualRadio.click();
            visibleIndividualRadio.dispatchEvent(new Event('change', { bubbles: true }));
            await delay(500);
            checkForAndClosePopups();
            await delay(500);
        } else if (visibleIndividualRadio) {
            log("'Individual' radio already checked.");
        } else {
            log("Could not find visible 'Individual' radio button.");
            return; // Stop if this fails
        }

        // 2. Fill Kendo Dropdowns Sequentially
        const locationInput = findVisibleElementNearLabel("Location");
        const categoryInput = findVisibleElementNearLabel("Category");
        const visaTypeInput = findVisibleElementNearLabel("Visa Type");


        if (locationInput && locationInput.id) {
            log(`Setting Location dropdown (#${locationInput.id}) to "${appointmentLocation}"`);
            executeInPageContext(setKendoDropdownValue, locationInput.id, appointmentLocation);
            await delay(1000); // Wait for potential changes
            checkForAndClosePopups();
            await delay(500);
        } else {
             log("Could not find Location dropdown input.");
             return; // Stop if critical field missing
        }

        if (categoryInput && categoryInput.id) {
             log(`Setting Category dropdown (#${categoryInput.id}) to "${appointmentCategory}"`);
            executeInPageContext(setKendoDropdownValue, categoryInput.id, appointmentCategory);
            await delay(1000);
            checkForAndClosePopups();
            await delay(500);
        } else {
             log("Could not find Category dropdown input.");
             return; // Stop if critical field missing
        }

        if (visaTypeInput && visaTypeInput.id) {
             log(`Setting Visa Type dropdown (#${visaTypeInput.id}) to "${appointmentVisaType}"`);
            executeInPageContext(setKendoDropdownValue, visaTypeInput.id, appointmentVisaType);
            await delay(2000); // **Increased wait**: Crucial for Visa Sub Type to load options
            checkForAndClosePopups();
            await delay(500);
        } else {
             log("Could not find Visa Type dropdown input.");
             return; // Stop if critical field missing
        }

        // Re-find Visa Sub Type input *after* Visa Type has been set and waited for
        const visaSubTypeInput = findVisibleElementNearLabel("Visa Sub Type");
        if (visaSubTypeInput && visaSubTypeInput.id) {
             log(`Setting Visa Sub Type dropdown (#${visaSubTypeInput.id}) to "${appointmentVisaSubType}"`);
             // Add a check/wait loop for options to appear in sub-type dropdown if needed
             executeInPageContext(setKendoDropdownValue, visaSubTypeInput.id, appointmentVisaSubType);
             await delay(1000);
             checkForAndClosePopups();
             await delay(500);
        } else {
             log("Could not find Visa Sub Type dropdown input after setting Visa Type.");
             // Don't necessarily stop here, maybe it's optional or appears later
        }

        // 3. Click Submit Button
        await delay(500);
        const submitButton = document.querySelector('#btnSubmit'); // Assuming stable ID
        if (submitButton && isElementVisibleAndEnabled(submitButton)) {
            log("Found appointment Submit button, clicking.");
            submitButton.click();
            log("Setting automation paused flag.");
            sessionStorage.setItem(AUTOMATION_PAUSED_KEY, 'true');
        } else {
            log("Appointment Submit button (#btnSubmit) not found or not interactable.");
        }
        return;
    }

    log("No specific action taken on this page load.");
}

// --- Initial Run ---
// Use a slightly longer initial delay
setTimeout(runAutomation, 1500);
