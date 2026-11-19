import json
import urllib.request

def test_files_endpoint():
    res = urllib.request.urlopen("http://127.0.0.1:8000/tasks")
    tasks = json.loads(res.read().decode())
    assert len(tasks) > 0, "No tasks found"
    task_id = tasks[0]["id"]
    print(f"Testing files endpoint for task {task_id}...")

    files_url = f"http://127.0.0.1:8000/tasks/{task_id}/files"
    f_res = urllib.request.urlopen(files_url)
    data = json.loads(f_res.read().decode())
    print("Response keys:", list(data.keys()))
    print("Working dir:", data.get("working_dir"))
    print("Total changed files:", data.get("total_changed"))
    for file in data.get("changed_files", []):
        print(f"  [{file.get('status')}] {file.get('path')}")
    print("SUCCESS: Endpoint works as expected!")

if __name__ == "__main__":
    test_files_endpoint()
