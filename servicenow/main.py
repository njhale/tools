import os
import sys
import asyncio

async def main():
    servicenow_oauth_token = os.getenv('SERVICENOW_OAUTH_TOKEN')
    if servicenow_oauth_token:
        print(servicenow_oauth_token)
    else:
        print("SERVICENOW_OAUTH_TOKEN is not set")
    sys.exit()

if __name__ == "__main__":
    asyncio.run(main())
