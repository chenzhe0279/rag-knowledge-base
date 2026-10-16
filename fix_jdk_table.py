"""清理 PyCharm 的 jdk.table.xml：
1. 先备份（若备份不存在）
2. 删除指向已删除的「根 .venv」的失效条目 uv (rag-knowledge-base)
3. 删除重复条目 Python 3.12 (rag-knowledge-base) (2)
4. 校验：删除后仍是合法 XML，且剩下的 Python 解释器条目正确

全程二进制读写，保证除目标段落外其余字节不变（含行尾风格）。
"""

import shutil
import xml.etree.ElementTree as ET
from pathlib import Path

OPT = Path(r"C:\Users\33020\AppData\Roaming\JetBrains\PyCharm2026.1\options")
SRC = OPT / "jdk.table.xml"
BAK = OPT / "jdk.table.xml.bak"

data = SRC.read_bytes()
print("original size :", len(data), "bytes")
print("CRLF count    :", data.count(b"\r\n"))

# --- 备份（不存在才建）---
if not BAK.exists():
    shutil.copy2(SRC, BAK)
    print("backup created:", BAK)
else:
    print("backup exists :", BAK)

UV_BLOCK = """    <jdk version="2">
      <name value="uv (rag-knowledge-base)" />
      <type value="Python SDK" />
      <version value="Python 3.12.8" />
      <homePath value="D:/soft/pythonProject/rag-knowledge-base/.venv/Scripts/python.exe" />
      <roots>
        <classPath>
          <root type="composite">
            <root url="file://D:/python/python32/DLLs" type="simple" />
            <root url="file://D:/python/python32/Lib" type="simple" />
            <root url="file://D:/python/python32" type="simple" />
            <root url="file://D:/soft/pythonProject/rag-knowledge-base/.venv" type="simple" />
            <root url="file://D:/soft/pythonProject/rag-knowledge-base/.venv/Lib/site-packages" type="simple" />
            <root url="file://$USER_HOME$/AppData/Local/JetBrains/PyCharm2026.1/python_stubs/1885831245" type="simple" />
            <root url="file://$APPLICATION_HOME_DIR$/plugins/python-ce/helpers/typeshed/stdlib" type="simple" />
            <root url="file://$APPLICATION_HOME_DIR$/plugins/python-ce/helpers/typeshed/stubs/six" type="simple" />
            <root url="file://$APPLICATION_HOME_DIR$/plugins/python-ce/helpers/typeshed/stubs/greenlet" type="simple" />
            <root url="file://$APPLICATION_HOME_DIR$/plugins/python-ce/helpers/typeshed/stubs/requests" type="simple" />
            <root url="file://$APPLICATION_HOME_DIR$/plugins/python-ce/helpers/typeshed/stubs/xmltodict" type="simple" />
            <root url="file://$APPLICATION_HOME_DIR$/plugins/python-ce/helpers/typeshed/stubs/SQLAlchemy" type="simple" />
          </root>
        </classPath>
        <sourcePath>
          <root type="composite" />
        </sourcePath>
      </roots>
      <additional ASSOCIATED_PROJECT_PATH="D:/soft/pythonProject/rag-knowledge-base" SDK_UUID="48162d4f-6844-4066-8267-8ec32f2d537a" IS_UV="true" UV_WORKING_DIR="D:\\soft\\pythonProject\\rag-knowledge-base" UV_VENV_PATH="D:\\soft\\pythonProject\\rag-knowledge-base\\.venv" UV_TOOL_PATH="C:\\Users\\33020\\.local\\bin\\uv.exe">
        <PATHS_TO_TRANSFER_ROOT PATH_TO_TRANSFER="file://D:/soft/pythonProject/rag-knowledge-base/backend/src" />
        <setting name="FLAVOR_ID" value="UvSdkFlavor" />
        <setting name="FLAVOR_DATA" value="{&quot;uvWorkingDirectory&quot;:&quot;D:\\soft\\pythonProject\\rag-knowledge-base&quot;,&quot;usePip&quot;:false,&quot;venvPath&quot;:&quot;D:\\soft\\pythonProject\\rag-knowledge-base\\.venv&quot;,&quot;uvPath&quot;:&quot;C:\\Users\\33020\\.local\\bin\\uv.exe&quot;}" />
      </additional>
    </jdk>
"""

DUP_BLOCK = """    <jdk version="2">
      <name value="Python 3.12 (rag-knowledge-base) (2)" />
      <type value="Python SDK" />
      <version value="Python 3.12.8" />
      <homePath value="D:/soft/pythonProject/rag-knowledge-base/backend/.venv/Scripts/python.exe" />
      <roots>
        <classPath>
          <root type="composite">
            <root url="file://D:/python/python32/DLLs" type="simple" />
            <root url="file://D:/python/python32/Lib" type="simple" />
            <root url="file://D:/python/python32" type="simple" />
            <root url="file://D:/soft/pythonProject/rag-knowledge-base/backend/.venv" type="simple" />
            <root url="file://D:/soft/pythonProject/rag-knowledge-base/backend/.venv/Lib/site-packages" type="simple" />
            <root url="file://$USER_HOME$/AppData/Local/JetBrains/PyCharm2026.1/python_stubs/110907240" type="simple" />
            <root url="file://$APPLICATION_HOME_DIR$/plugins/python-ce/helpers/typeshed/stdlib" type="simple" />
          </root>
        </classPath>
        <sourcePath>
          <root type="composite" />
        </sourcePath>
      </roots>
      <additional ASSOCIATED_PROJECT_PATH="D:/soft/pythonProject/rag-knowledge-base" SDK_UUID="0ee4daaf-29f7-4151-8777-e67b963677e9">
        <setting name="FLAVOR_ID" value="VirtualEnvSdkFlavor" />
        <setting name="FLAVOR_DATA" value="{}" />
      </additional>
    </jdk>
"""

for eol_name, eol in (("LF", "\n"), ("CRLF", "\r\n")):
    for label, block in (("uv(root .venv)", UV_BLOCK), ("duplicate(2)", DUP_BLOCK)):
        pat = block.replace("\n", eol).encode("utf-8")
        n = data.count(pat)
        print(f"pattern {label:<16} [{eol_name}] occurrences: {n}")
        if n == 1:
            data = data.replace(pat, b"", 1)

SRC.write_bytes(data)
print("\nnew size      :", len(data), "bytes  (removed", SRC.stat().st_size and 0, "n/a)")

ET.parse(SRC)
print("XML parse     : OK")
root = ET.parse(SRC).getroot()
for e in root.iter("name"):
    if e.text and "rag-knowledge-base" in e.text:
        print("   remaining SDK:", e.text)
