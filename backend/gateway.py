import hashlib
import json
import os

from litellm import Router
from litellm.caching import Cache
from litellm.exceptions import APIError


class ProvidersUnavailable(Exception):
    pass


def create_gateway():
    keys = [
        key.strip()
        for key in os.getenv("LLM_API_KEYS", "").split(",")
        if key.strip()
    ]
    model = os.getenv("LLM_MODEL", "").strip()

    if len(set(keys)) < 2 or not model:
        return None, 0

    deployments = [
        {
            "model_name": f"key_{index}",
            "litellm_params": {"model": model, "api_key": key},
        }
        for index, key in enumerate(keys, start=1)
    ]

    router = Router(
        model_list=deployments,
        cache_responses=False,
        num_retries=0,
    )
    return router, len(deployments)


def create_response_cache():
    return Cache(type="local").cache


def complete_with_failover(
    router, key_count, model, messages, simulated_failures, cache
):
    cache_input = json.dumps(
        {"model": model, "messages": messages},
        sort_keys=True,
        ensure_ascii=False,
    )
    cache_key = hashlib.sha256(cache_input.encode("utf-8")).hexdigest()

    if not simulated_failures:
        cached = cache.get_cache(cache_key)
        if cached is not None:
            return cached, None, 0

    for index in range(1, key_count + 1):
        key_id = f"key_{index}"
        if "*" in simulated_failures or key_id in simulated_failures:
            continue

        try:
            result = router.completion(
                model=key_id,
                messages=messages,
                caching=False,
                timeout=30,
            )
        except APIError as error:
            status = getattr(error, "status_code", None)
            if status == 429 or (isinstance(status, int) and 500 <= status < 600):
                continue
            raise ProvidersUnavailable from None

        reply = result.choices[0].message.content if result.choices else None
        usage = result.usage
        if (
            not reply
            or not reply.strip()
            or usage is None
            or usage.prompt_tokens is None
            or usage.completion_tokens is None
        ):
            continue

        answer = {
            "reply": reply,
            "input_tokens": usage.prompt_tokens,
            "output_tokens": usage.completion_tokens,
        }
        if not simulated_failures:
            cache.set_cache(cache_key, answer)

        return answer, key_id, index - 1

    raise ProvidersUnavailable