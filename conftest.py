import asyncio
import inspect


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "asyncio: run an async test function in a dedicated event loop",
    )


def pytest_pyfunc_call(pyfuncitem):
    if "asyncio" not in pyfuncitem.keywords:
        return None

    test_function = pyfuncitem.obj
    if not inspect.iscoroutinefunction(test_function):
        return None

    loop = asyncio.new_event_loop()
    asyncio.set_event_loop(loop)
    try:
        kwargs = {
            name: pyfuncitem.funcargs[name]
            for name in pyfuncitem._fixtureinfo.argnames
        }
        loop.run_until_complete(test_function(**kwargs))
    finally:
        loop.close()
        asyncio.set_event_loop(None)

    return True
