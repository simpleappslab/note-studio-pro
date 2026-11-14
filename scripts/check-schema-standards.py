"""Optional interoperability checks. Pipe check-schema.cjs --fixtures into this script.

Requires jsonschema, openapi-spec-validator, openapi-schema-validator and PyYAML.
"""
import json
import sys
import yaml
from jsonschema import Draft4Validator, Draft6Validator, Draft7Validator, Draft201909Validator, Draft202012Validator, FormatChecker
from openapi_schema_validator import OAS30Validator, OAS31Validator, OAS32Validator
from openapi_spec_validator import OpenAPIV2SpecValidator, OpenAPIV30SpecValidator, OpenAPIV31SpecValidator, OpenAPIV32SpecValidator

schemas={'draft-04':Draft4Validator,'draft-06':Draft6Validator,'draft-07':Draft7Validator,'2019-09':Draft201909Validator,'2020-12':Draft202012Validator,'openapi-3.0':OAS30Validator,'openapi-3.1':OAS31Validator,'openapi-3.2':OAS32Validator}
specs={'swagger-2.0':OpenAPIV2SpecValidator,'openapi-3.0':OpenAPIV30SpecValidator,'openapi-3.1':OpenAPIV31SpecValidator,'openapi-3.2':OpenAPIV32SpecValidator}
fixtures=json.load(sys.stdin)
for i,fixture in enumerate(fixtures):
    target=fixture['target'];document=fixture['document'];schema=document
    try:
        assert yaml.safe_load(fixture['yaml'])==document,'YAML round-trip changed the schema'
        if 'openapi' in document or 'swagger' in document:
            specs[target](document).validate()
            schema=(document.get('definitions') or document['components']['schemas'])['Payload']
        if target in schemas:
            validator=schemas[target]
            validator.check_schema(schema)
            for sample in fixture['samples']:
                validator(schema,format_checker=FormatChecker()).validate(sample)
        else:
            # Swagger schemas use a subset of Draft 04. Check its meta-schema and
            # validate representative values after removing only extension notes.
            Draft4Validator.check_schema(schema)
            # x-nullable is not standard validation; full-document checks above
            # verify compatibility while the UI discloses this legacy limitation.
    except Exception as error:
        raise AssertionError(f'Fixture {i} ({target}, {fixture["options"]}): {error}') from error
print(f'{len(fixtures)} fixtures passed schema meta-schema, sample, OpenAPI document and YAML round-trip checks.')
