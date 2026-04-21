/**
 * Extract assessment items from PIQI API response for detailed logging
 * Mirrors the Data Class Results Summary structure from SimpleLabPIQIClient.html
 */

const DATA_CLASS_PATHS = {
    'Lab Results': 'labResults',
    'Medications': 'medications',
    'Allergies': 'allergies',
    'Conditions': 'conditions',
    'Procedures': 'procedures',
    'Vital Signs': 'vitalSigns',
    'Immunizations': 'immunizations',
    'Demographics': 'demographics',
    'Encounters': 'encounters',
    'Providers': 'providers',
    'Clinical Documents': 'clinicalDocuments',
    'Diagnostic Imaging': 'diagnosticImaging',
    'Goals': 'goals',
    'Health Assessments': 'healthAssessments',
    'Medical Devices': 'medicalDevices'
};

/**
 * Format attribute value for storage (truncate very long values)
 */
function formatAttributeValue(value) {
    if (value === undefined || value === null) return 'N/A';
    
    let displayValue;
    if (typeof value === 'object') {
        displayValue = JSON.stringify(value);
    } else if (typeof value === 'string') {
        displayValue = value;
    } else {
        displayValue = String(value);
    }
    
    // Truncate to reasonable length for storage
    const MAX_LENGTH = 1000;
    return displayValue.length > MAX_LENGTH 
        ? displayValue.substring(0, MAX_LENGTH) + '...' 
        : displayValue;
}

/**
 * Extract all assessment items from a PIQI response
 * Returns array of assessment records ready for database insertion
 */
function extractAssessmentItems(messageId, responseBody) {
    const assessmentRecords = [];
    
    if (!responseBody) {
        return assessmentRecords;
    }
    
    let parsedResponse;
    try {
        parsedResponse = typeof responseBody === 'string' 
            ? JSON.parse(responseBody) 
            : responseBody;
    } catch (e) {
        // Response is not JSON or is malformed
        return assessmentRecords;
    }
    
    // Check for audited message in response
    const auditedMessage = parsedResponse.auditedMessage || parsedResponse.messageData;
    if (!auditedMessage) {
        return assessmentRecords;
    }
    
    let parsedMessage;
    try {
        parsedMessage = typeof auditedMessage === 'string' 
            ? JSON.parse(auditedMessage) 
            : auditedMessage;
    } catch (e) {
        return assessmentRecords;
    }
    
    if (!parsedMessage.patient) {
        return assessmentRecords;
    }
    
    // Iterate through each data class
    for (const [dataClassName, dataPath] of Object.entries(DATA_CLASS_PATHS)) {
        if (!parsedMessage.patient[dataPath] || !Array.isArray(parsedMessage.patient[dataPath])) {
            continue;
        }
        
        const dataArray = parsedMessage.patient[dataPath];
        
        // Iterate through each data element in the array
        dataArray.forEach(element => {
            if (!element || typeof element !== 'object') {
                return;
            }
            
            for (const attributeKey in element) {
                if (!element.hasOwnProperty(attributeKey) || !element[attributeKey]) {
                    continue;
                }
                
                const attribute = element[attributeKey];
                
                // Extract attribute value from data property
                const attributeValue = formatAttributeValue(attribute.data);
                
                // Check for assessment items in attributeAudit
                if (!attribute.attributeAudit || !attribute.attributeAudit.assessmentItems) {
                    continue;
                }
                
                const assessmentItems = attribute.attributeAudit.assessmentItems;
                
                if (!Array.isArray(assessmentItems)) {
                    continue;
                }
                
                // Create a record for each assessment item
                assessmentItems.forEach(item => {
                    assessmentRecords.push({
                        messageId: messageId,
                        dataClass: dataClassName,
                        attributeName: item.attributeName || attributeKey,
                        attributeValue: attributeValue,
                        assessment: item.assessment || '',
                        status: item.status || '',
                        reason: item.reason || '',
                        effect: item.effect || ''
                    });
                });
            }
        });
    }
    
    return assessmentRecords;
}

module.exports = {
    extractAssessmentItems
};
