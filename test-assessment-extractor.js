#!/usr/bin/env node

/**
 * Test the assessment extractor module with a sample PIQI response
 */

const { extractAssessmentItems } = require('./src/audit/assessment-extractor');

// Sample PIQI response structure (simplified)
const sampleResponse = {
    auditedMessage: JSON.stringify({
        patient: {
            labResults: [
                {
                    testResult: {
                        data: '7.4',
                        attributeAudit: {
                            assessmentItems: [
                                {
                                    attributeName: 'pH',
                                    attributeMnemonic: 'pH',
                                    assessment: 'ReferenceRange',
                                    status: 'PASSED',
                                    reason: 'Value within reference range',
                                    effect: 'No action needed'
                                }
                            ]
                        }
                    }
                }
            ],
            medications: [
                {
                    medication: {
                        data: 'Lisinopril 10mg',
                        attributeAudit: {
                            assessmentItems: [
                                {
                                    attributeName: 'DrugName',
                                    assessment: 'CodeableConceptMapping',
                                    status: 'CONDITIONAL_PASS',
                                    reason: 'Partial mapping found',
                                    effect: 'Review recommended'
                                }
                            ]
                        }
                    }
                }
            ]
        }
    })
};

console.log('=== Assessment Extractor Test ===\n');

const messageId = 'TEST-MSG-12345';
const items = extractAssessmentItems(messageId, JSON.stringify(sampleResponse));

console.log(`Extracted ${items.length} assessment items:\n`);

items.forEach((item, idx) => {
    console.log(`[${idx + 1}]`);
    console.log(`  Message ID: ${item.messageId}`);
    console.log(`  Data Class: ${item.dataClass}`);
    console.log(`  Attribute: ${item.attributeName}`);
    console.log(`  Value: ${item.attributeValue}`);
    console.log(`  Assessment: ${item.assessment}`);
    console.log(`  Status: ${item.status}`);
    console.log(`  Reason: ${item.reason}`);
    console.log(`  Effect: ${item.effect}`);
    console.log();
});

if (items.length === 0) {
    console.error('⚠ No assessment items extracted. Check response structure.');
    process.exit(1);
}

console.log(`✓ Test passed - extracted ${items.length} items as expected`);
