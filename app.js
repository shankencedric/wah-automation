const { chromium } = require('playwright');
require('dotenv').config();

// Import the external developer's dictionary from the JSON file
const DIAGNOSIS_MAP = require('./diagnoses.json');

const CONFIG = require('./config.json');

let reloadCount = 0; 
let globalAutomationData = {
    totalCount: 0,
    skippedCount: 0,
    endedVisitCount: 0,
    executionTimeSeconds: 0,
    attempts: 0,
    startedAtRow: CONFIG.startAtRow,
    startedAtPage: CONFIG.startAtPage,
    skippedPatientsList: []
};

async function startAutomation() {
    const browser = await chromium.launch({ headless: false, slowMo: CONFIG.debug_mode ? 200 : 50 });
    const context = await browser.newContext();
    const page = await context.newPage();

    await tryLogIn(page);
    await runAutomationBody(page, browser);
}

async function tryLogIn(page) {
    console.log(`🚀 Navigating to portal at ${process.env.URL}...`);
    await page.goto(process.env.URL);

    // 1. Log In using EMAIL and PASSWORD keys
    await page.locator('input[type="email"], input[type="text"]').first().fill(process.env.EMAIL);
    await page.locator('input[type="password"]').first().fill(process.env.PASSWORD);
    await page.getByRole('button', { name: /sign in/i }).click();
    
    await page.waitForLoadState('networkidle');
}

async function clickHomeButton(page) {
    await page.locator('app-header svg[data-icon="house"]').first().click();
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(2000); // artificially wait to slow down
}

async function runAutomationBody(page, browser) {

    // Some automation data for THIS run
    let endedVisitCount = 0;
    const skippedPatientNames = new Set(globalAutomationData.skippedPatientsList);
    let totalCount = 0;
    const startTime = Date.now();
    let hasCrashed = false;

    try {
        console.log(`\n🔢 Will start at row ${CONFIG.startAtRow} on page ${CONFIG.startAtPage}...\n`);

        while (true) {
            if (CONFIG.debug_mode && endedVisitCount >= CONFIG.debug_endedVisitTargetCount) {
                console.log(`🛑 DEBUG MODE: Reached limit of ${CONFIG.debug_endedVisitTargetCount} successful runs. Exiting loop.`);
                break;
            }

            totalCount = endedVisitCount + skippedPatientNames.size;
            console.log(`--- Starting loop ${totalCount} ---`);

            // 3a. Click the doctor dropdown and filter by ID key
            const providerDropdown = page.locator('app-todays-consult select').first();
            await providerDropdown.waitFor({ state: 'visible' });
            
            console.log("🕝 Running arbitrary wait time for patient list to fully load.");
            await page.waitForTimeout(3000); // artificially wait to slow down

            await providerDropdown.selectOption({ value: process.env.WAH_UUID });
            await page.waitForLoadState('networkidle');

            // PAGINATION CHECK: Check if skipped count has reached a multiple of 40 to turn the page
            let currentPage = 0;
            const skipCount = (globalAutomationData.startedAtRow-1 + skippedPatientNames.size); // -1 because that exact row will be put into skippedPatientNames
            const targetPage = Math.max( CONFIG.startAtPage, Math.floor( skipCount / 40 ));
            while (targetPage > currentPage) {
                console.log(`📄 Skipped count reached ${skipCount}. Turning to next page of results...`);
                
                // Target the pagination "Next" button specifically using the text "Next" inside the nav bar
                const nextButton = page.locator('app-todays-consult nav').getByRole('button', { name: /next/i }).first();
                await nextButton.waitFor({ state: 'visible' });

                // 🛑 LAST PAGE CHECK: End automation if we need to turn the page but the button is disabled
                if (await nextButton.isDisabled()) {
                    console.log("🛑 'Next' button is disabled. We have reached the final page of records.");
                    break;
                }
                
                // Next page
                await nextButton.click();
                await page.waitForLoadState('networkidle');
                await page.waitForTimeout(5000); // artificially wait to slow down

                currentPage++;
                console.log(`⏩ Now on page #${currentPage}`);
            }

            // Fetch the current visible list of patient rows
            const rowLocator = page.locator('app-todays-consult .border-b.border-gray-200');
            try {
                await rowLocator.first().waitFor({ state: 'visible', timeout: 10000 });
            } catch (error) {
                console.log("📋 Detected 0 patients (Timeout reached).");
            }
            
            const patientRows = await rowLocator.all();
            let targetPatientRow = null;
            let targetPatientName = "";

            console.log(`📋 Detected ${patientRows.length} patients.`);

            // Look for the topmost unchecked person who hasn't been skipped yet
            const validRowSkip = Math.max(1, CONFIG.startAtRow); // 1-indexed
            let rowIdx = targetPage > CONFIG.startAtPage ? 1 : validRowSkip; // if beyond the starting page, no more skip
            for (; rowIdx <= patientRows.length; rowIdx++) {
                const row = patientRows[rowIdx-1]; 

                // Get all the text inside the entire patient row card
                const fullRowText = await row.innerText().catch(() => "");
                
                // Split the text by newlines and look for the line containing a comma 
                const textLines = fullRowText.split('\n');
                const nameLine = textLines.find(line => line.includes(',')); 

                if (nameLine && !skippedPatientNames.has(nameLine.trim())) {
                    targetPatientRow = row;
                    targetPatientName = nameLine.trim();
                    break; 
                }
            }

            // If no un-skipped patients are found, the queue is clear
            if (!targetPatientRow) {
                console.log("🎉 All eligible patient records processed or skipped!");
                break;
            }

            console.log(`\nProcessing patient #${totalCount} on Row ${rowIdx}: ${targetPatientName}`);

            // 3b. Click the Consultation button of the target patient
            const consultButton = targetPatientRow.locator('button, a, div.btn').filter({ hasText: /consultation|cn/i }).first();
            await consultButton.click();
            await page.waitForLoadState('networkidle');

            console.log("🕝 Running arbitrary wait time for patient record to fully load.");
            await page.waitForTimeout(5000); // artificially wait to slow down

            // 3c. Target Angular Initial Diagnosis selected chips
            const initialDxContainer = page.locator('app-initial-dx');
            await initialDxContainer.waitFor({ state: 'visible', timeout: 15000 });

            const initialDiagLocator = initialDxContainer.locator('.ng-value-label');

            // Ensure an initial diagnosis exists before proceeding
            if (await initialDiagLocator.count() === 0) {
                console.log(`⚠️ No initial diagnosis found for ${targetPatientName}. Skipping.`);
                skippedPatientNames.add(targetPatientName);
                
                // Click "Home" link icon to reset
                await clickHomeButton(page);
                continue;
            }

            // Retrieve selected initial diagnosis, removing trailing clear icons if any
            const initialDiagnosisText = (await initialDiagLocator.first().innerText()).trim();

            // 3c1. Skip logic if the tag doesn't match our allowed mappings
            if (!DIAGNOSIS_MAP[initialDiagnosisText]) {
                console.log(`⚠️ Unmapped diagnosis [${initialDiagnosisText}]. Skipping.`);
                skippedPatientNames.add(targetPatientName);
                
                // 3d. Click Home button 
                await clickHomeButton(page);
                continue;
            }

            // 3c2. If matched -> Proceed to Final Diagnosis
            const finalDiagCode = DIAGNOSIS_MAP[initialDiagnosisText];
            console.log(`✅ Mapping to code: ${finalDiagCode}`);
            
            // 3c2a. Locate the input search bar inside the Diagnosis section
            const finalDiagInput = page.locator('app-final-dx ng-select input[type="text"]');
            await finalDiagInput.click();
            
            // 3c2b. Input the code and click the item from the dynamic search dropdown
            await finalDiagInput.fill(finalDiagCode);
            const dynamicDropdownResult = page.locator('.ng-dropdown-panel .ng-option').getByText(finalDiagCode, { exact: false }).first();
            await dynamicDropdownResult.waitFor({ state: 'visible', timeout: 5000 });
            await page.waitForTimeout(1000); // artificially wait to slow down
            await dynamicDropdownResult.click();

            // 3c2c. Click save strictly on the Final Diagnosis component to avoid strict mode errors
            await page.locator('app-final-dx').getByRole('button', { name: /save/i }).click();
            await page.waitForTimeout(1000); // artificially wait to slow down
            
            // 3c2e. Click "End Visit" on the middle section header actions
            await page.locator('.consultation-header-actions').getByRole('button', { name: /end visit/i }).first().click();
            await page.waitForTimeout(1000); // artificially wait to slow down

            // 3c2f. Handle the modal/popup confirmation
            const modalEndVisitBtn = page.getByRole('dialog').getByRole('button', { name: /end visit/i });
            await modalEndVisitBtn.waitFor({ state: 'visible' });
            await page.waitForTimeout(1000); // artificially wait to slow down
            await modalEndVisitBtn.click();
            
            endedVisitCount++;

            // 3d. Click the "Home" link icon in the upper right corner toolbar to reset the loop
            await clickHomeButton(page);
        }
    } catch (error) {
        console.error("❌ Automation encountered an error:", error);
        hasCrashed = true;
    } finally {
        
        const skippedCount = skippedPatientNames.size;
        const totalCount = endedVisitCount + skippedCount;
        const endTime = Date.now();
        const executionTimeSeconds = ((endTime - startTime) / 1000).toFixed(2);
        
        automationDataThisRun = {
            totalCount: totalCount,
            skippedCount: skippedCount,
            endedVisitCount: endedVisitCount,
            executionTimeSeconds: parseFloat(executionTimeSeconds),
            skippedPatientsList: Array.from(skippedPatientNames),
        };

        globalAutomationData.totalCount += automationDataThisRun.endedVisitCount;
        globalAutomationData.skippedCount = automationDataThisRun.skippedCount;
        globalAutomationData.endedVisitCount += automationDataThisRun.endedVisitCount;
        globalAutomationData.executionTimeSeconds += automationDataThisRun.executionTimeSeconds;
        globalAutomationData.skippedPatientsList = [...globalAutomationData.skippedPatientsList, ...automationDataThisRun.skippedPatientsList];

        if (hasCrashed && CONFIG.attemptReload && reloadCount < CONFIG.reloadAttempts)
        {
            console.warn(`⚠️ Error received. Restarting automation (Attempt ${++reloadCount}/${CONFIG.reloadAttempts})...`);
            
            console.log(`\n📊 --- Automation Run Summary (Attempt ${reloadCount}) ---`);
            console.log(JSON.stringify(automationDataThisRun, null, 4));
            
            await page.waitForTimeout(3000);
            await browser.close();
            await startAutomation();

        }
        else {
            globalAutomationData.attempts = reloadCount;

            console.log('\n📊 --- Automation Run Summary (Complete) ---');
            console.log(JSON.stringify(globalAutomationData, null, 4));
            
            console.log(`🟢 AUTOMATION COMPLETE: Exiting after ${globalAutomationData.endedVisitCount} successful end visits.`);
            await page.waitForTimeout(3000);
            await browser.close();
        }
    }
}

startAutomation();