function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function submitWithRetry(options) {
    const startedAt = new Date();
    const maxRetries = Number.isInteger(options.maxRetries) ? options.maxRetries : 0;
    const retryDelayMs = Number.isInteger(options.retryDelayMs) ? options.retryDelayMs : 1000;

    let attempt = 0;
    let lastErrorType = null;
    let lastErrorMessage = null;

    while (attempt <= maxRetries) {
        attempt += 1;
        const requestTimestamp = new Date();

        try {
            const response = await fetch(options.apiUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: typeof options.requestBodyText === 'string'
                    ? options.requestBodyText
                    : JSON.stringify(options.requestBody)
            });

            const responseTimestamp = new Date();
            const contentType = response.headers.get('content-type') || '';

            const responseBodyText = await response.text();
            let parsedBody = responseBodyText;
            if (contentType.includes('application/json') && responseBodyText) {
                try {
                    parsedBody = JSON.parse(responseBodyText);
                } catch (error) {
                    parsedBody = responseBodyText;
                }
            }

            return {
                startedAt,
                requestTimestamp,
                responseTimestamp,
                completedAt: new Date(),
                attemptCount: attempt,
                statusCode: response.status,
                isSuccess: response.ok,
                responseBody: parsedBody,
                responseBodyText,
                errorType: response.ok ? null : 'http_error',
                errorMessage: response.ok ? null : 'HTTP ' + response.status
            };
        } catch (error) {
            lastErrorType = 'network_error';
            lastErrorMessage = error && error.message ? error.message : String(error);

            if (attempt > maxRetries) {
                const responseTimestamp = new Date();
                return {
                    startedAt,
                    requestTimestamp,
                    responseTimestamp,
                    completedAt: new Date(),
                    attemptCount: attempt,
                    statusCode: null,
                    isSuccess: false,
                    responseBody: null,
                    responseBodyText: null,
                    errorType: lastErrorType,
                    errorMessage: lastErrorMessage
                };
            }

            await sleep(retryDelayMs);
        }
    }

    const responseTimestamp = new Date();
    return {
        startedAt,
        requestTimestamp: startedAt,
        responseTimestamp,
        completedAt: new Date(),
        attemptCount: maxRetries + 1,
        statusCode: null,
        isSuccess: false,
        responseBody: null,
        responseBodyText: null,
        errorType: lastErrorType,
        errorMessage: lastErrorMessage
    };
}

module.exports = {
    submitWithRetry
};
