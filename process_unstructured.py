# process_unstructured.py
import sys
import json
import os
from unstructured_client import UnstructuredClient
from unstructured_client.models import operations, shared
import boto3
import io

# Get input file path and API key from command line arguments
input_file_path = sys.argv[1]
api_key = os.getenv("UNSTRUCTURED_API_KEY")
file_name = sys.argv[2]

# Initialize S3 client
s3 = boto3.client('s3',
    aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
    aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY'),
    region_name='us-east-1'
)

# Initialize Unstructured client
client = UnstructuredClient(
    api_key_auth=api_key
)

try:
    # Process the file with Unstructured SDK
    with open(input_file_path, 'rb') as file:
        req = operations.PartitionRequest(
            partition_parameters=shared.PartitionParameters(
                files=shared.Files(
                    content=file,
                    file_name=file_name,
                ),
                strategy=shared.Strategy.VLM,
                vlm_model="gpt-4o",
                vlm_model_provider="openai",
                languages=['eng'],
                split_pdf_page=True,
                split_pdf_allow_failed=True,
                split_pdf_concurrency_level=15
            )
        )
        res = client.general.partition(request=req)
        element_dicts = [element for element in res.elements]

    # Convert to JSON
    json_elements = json.dumps(element_dicts, indent=2)

    # Upload embeddings to S3 outputs/
    output_file_name = f'{file_name}-embeddings.json'
    s3.upload_fileobj(
        io.BytesIO(json_elements.encode()),
        'demo-unstructured-io',
        f'outputs/{output_file_name}',
        ExtraArgs={'ContentType': 'application/json'}
    )

    # Return the output S3 URL
    output_s3_url = f'https://demo-unstructured-io.s3.amazonaws.com/outputs/{output_file_name}'
    print(json.dumps({'output_s3_url': output_s3_url}))

except Exception as e:
    print(json.dumps({'error': str(e)}), file=sys.stderr)
    sys.exit(1)