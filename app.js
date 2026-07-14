const { chromium } = require('playwright');
require('dotenv').config();

// Import the external developer's dictionary from the JSON file
const DIAGNOSIS_MAP = require('./diagnoses.json');

async function runAutomation() {
    const browser = await chromium.launch({ headless: false, slowMo: 100 });
    const context = await browser.newContext();
    const page = await context.newPage();

    try {
        console.log(`🚀 Navigating to portal at ${process.env.URL}...`);
        await page.goto(process.env.URL);

        // 1. Log In using EMAIL and PASSWORD keys
        await page.locator('input[type="email"], input[type="text"]').first().fill(process.env.EMAIL);
        await page.locator('input[type="password"]').first().fill(process.env.PASSWORD);
        await page.getByRole('button', { name: /sign in/i }).click();
        
        await page.waitForLoadState('networkidle');

        // Track skipped patient names to prevent infinite loops on unmapped conditions
        const skippedPatientNames = new Set();

        while (true) {
            // 3a. Click the doctor dropdown and filter by NAME key
            const providerDropdown = page.locator('app-todays-consult select').first();
            await providerDropdown.waitFor({ state: 'visible' });
            await providerDropdown.selectOption({ value: process.env.DOCTOR_ID });
            await page.waitForLoadState('networkidle');

            // Fetch the current visible list of patient rows
            const patientRows = await page.locator('app-todays-consult .border-b.border-gray-200').all();
            let targetPatientRow = null;
            let targetPatientName = "";

            // Look for the topmost unchecked person who hasn't been skipped yet
            for (const row of patientRows) {
                const nameCell = row.locator('span.text-sm').first();
                const nameText = await nameCell.innerText().catch(() => "");
                
                if (nameText && !skippedPatientNames.has(nameText.trim())) {
                    targetPatientRow = row;
                    targetPatientName = nameText.trim();
                    break; 
                }
            }

            // If no un-skipped patients are found, the queue is clear
            if (!targetPatientRow) {
                console.log("🎉 All eligible patient records processed or skipped!");
                break;
            }

            console.log(`Processing patient: ${targetPatientName}`);

            // 3b. Click the Consultation button of the target patient
            const consultButton = targetPatientRow.getByRole('button', { name: /consultation|cn/i });
            await consultButton.click();
            await page.waitForLoadState('networkidle');

            // 3c. Target Angular Initial Diagnosis selected chips
            const initialDiagLocator = page.locator('app-initial-dx .ng-value-label');

            // Ensure an initial diagnosis exists before proceeding
            if (await initialDiagLocator.count() === 0) {
                console.log(`⚠️ No initial diagnosis found for ${targetPatientName}. Skipping.`);
                skippedPatientNames.add(targetPatientName);
                
                // Click "Home" link icon to reset
                await page.locator('app-header svg[data-icon="house"]').first().click();
                continue;
            }

            // Retrieve selected initial diagnosis, removing trailing clear icons if any
            const initialDiagnosisText = (await initialDiagLocator.first().innerText()).replace(/[\u00D7x]$/, '').trim();

            // 3c1. Skip logic if the tag doesn't match our allowed mappings
            if (!DIAGNOSIS_MAP[initialDiagnosisText]) {
                console.log(`⚠️ Unmapped diagnosis [${initialDiagnosisText}]. Skipping.`);
                skippedPatientNames.add(targetPatientName);
                
                // 3d. Click Home button 
                await page.locator('app-header svg[data-icon="house"]').first().click();
                continue;
            }

            // 3c2. If matched -> Proceed to Final Diagnosis
            const target = DIAGNOSIS_MAP[initialDiagnosisText];
            console.log(`✅ Mapping to code: ${target}`);
            
            // 3c2a. Locate the input search bar inside the Diagnosis section
            const finalDiagInput = page.locator('app-final-dx ng-select input[type="text"]');
            await finalDiagInput.click();
            
            // 3c2b. Input the code and click the item from the dynamic search dropdown
            await finalDiagInput.fill(target);
            const dynamicDropdownResult = page.locator('.ng-dropdown-panel .ng-option').getByText(target, { exact: false }).first();
            await dynamicDropdownResult.waitFor({ state: 'visible', timeout: 5000 });
            await dynamicDropdownResult.click();

            // 3c2c. Click save strictly on the Final Diagnosis component to avoid strict mode errors
            await page.locator('app-final-dx').getByRole('button', { name: /save/i }).click();
            
            // 3c2d. Scroll to the top of the page
            await page.evaluate(() => window.scrollTo(0, 0));
            
            // 3c2e. Click "End Visit" on the middle section header actions
            await page.locator('.consultation-header-actions').getByRole('button', { name: /end visit/i }).first().click();

            // 3c2f. Handle the modal/popup confirmation
            const modalEndVisitBtn = page.getByRole('dialog').getByRole('button', { name: /end visit/i });
            await modalEndVisitBtn.waitFor({ state: 'visible' });
            await modalEndVisitBtn.click();

            // 3d. Click the "Home" link icon in the upper right corner toolbar to reset the loop
            await page.locator('app-header svg[data-icon="house"]').first().click();
            await page.waitForLoadState('networkidle');
        }
    } catch (error) {
        console.error("❌ Automation encountered an error:", error);
    } finally {
        await page.waitForTimeout(3000);
        await browser.close();
    }
}

runAutomation();