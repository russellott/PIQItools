@echo off
setlocal

echo Starting PIQI Engine Server...
start "PIQI Engine Server" cmd /k "dotnet run --project C:\Users\rott\Documents\GitHub\reference_application\PIQI_Engine.Server\PIQI_Engine.Server.csproj"

echo Starting FHIR Converter API...
start "FHIR Converter API" cmd /k "dotnet run --project C:\Users\rott\Documents\GitHub\FHIR-Converter\src\Microsoft.Health.Fhir.Liquid.Converter.Api\Microsoft.Health.Fhir.Liquid.Converter.Api.csproj"

echo Both servers launched.
exit /b
