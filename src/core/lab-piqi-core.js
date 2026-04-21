const COLUMN_MAP = {
    UniqueID: 0,
    LongAccessionNumberUID: 1,
    LabChemTestSID: 2,
    LabChemTestName: 3,
    LabChemTestUrgencySID: 4,
    Urgency: 5,
    LabChemResultValue: 6,
    LabChemResultNumericValue: 7,
    TopographySID: 8,
    Topography: 9,
    AccessionInstitutionSID: 10,
    AccessioningInstitution: 11,
    OrderingInstitutionSID: 12,
    OrderingInstutionName: 13,
    CollectingInstitutionSID: 14,
    CollectingInstitutionName: 15,
    LOINCSID: 16,
    LOINC: 17,
    Units: 18,
    Abnormal: 19,
    RefHigh: 20,
    RefLow: 21
};

function normalizeCell(value) {
    if (value === undefined || value === null) return '';
    return String(value).trim();
}

function rowToColumns(rowValues) {
    return rowValues.map(normalizeCell);
}

function convertSpreadsheetRowToMessageData(rowValues, context) {
    const values = rowToColumns(rowValues);
    const uniqueID = values[COLUMN_MAP.UniqueID] || '';
    const unitsValue = values[COLUMN_MAP.Units] || '';

    const labResult = {
        test: {
            codings: [],
            text: values[COLUMN_MAP.LabChemTestName] || ''
        },
        referenceRange: {},
        resultValue: {
            text: values[COLUMN_MAP.LabChemResultValue] || '',
            type: { text: 'PQ' }
        },
        resultUnit: {
            codings: unitsValue
                ? [{ code: unitsValue, display: unitsValue, system: 'UCUM' }]
                : [],
            text: unitsValue
        }
    };

    const loincCode = values[COLUMN_MAP.LOINC];
    if (loincCode) {
        labResult.test.codings.push({
            code: loincCode,
            display: values[COLUMN_MAP.LabChemTestName] || '',
            system: '2.16.840.1.113883.6.1'
        });
    }

    const refLow = values[COLUMN_MAP.RefLow];
    const refHigh = values[COLUMN_MAP.RefHigh];

    if (refLow) {
        labResult.referenceRange.lowValue = refLow;
    }

    if (refHigh) {
        labResult.referenceRange.highValue = refHigh;
    }

    const abnormal = values[COLUMN_MAP.Abnormal];
    labResult.interpretation = abnormal
        ? {
            codings: [{ code: abnormal, system: '2.16.840.1.113883.5.83' }],
            text: abnormal
        }
        : {
            codings: [{ code: 'N', system: '2.16.840.1.113883.5.83' }],
            text: 'N'
        };

    return {
        messageId: uniqueID,
        formatID: '',
        useCaseID: '',
        patient: {
            labResults: [labResult],
            id: uniqueID
        },
        dataSourceID: context.dataSourceID,
        dataProviderID: context.dataProviderID,
        messageID: uniqueID
    };
}

function buildPiqiValidationRequest(options) {
    const messageID = options.messageData.messageID || options.messageData.messageId || '';

    return {
        dataProviderID: options.dataProviderID,
        dataSourceID: options.dataSourceID,
        messageID,
        piqiModelMnemonic: options.piqiModelMnemonic,
        evaluationRubricMnemonic: options.evaluationRubricMnemonic,
        messageData: JSON.stringify(options.messageData)
    };
}

module.exports = {
    COLUMN_MAP,
    convertSpreadsheetRowToMessageData,
    buildPiqiValidationRequest
};
