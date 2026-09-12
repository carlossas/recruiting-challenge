# Written answers — Carlos Adrian Garcia Reyes

## Authorship declaration

I created this written_answers markdown fully, I just use AI for validate spelling. 

---

## Q1 — Production correctness validation

I refactored a rostering service that charge and map third party users to our data schemas in mongodb, the systems works 2000% faster than old system but we don't implement on the first version a great observation (just some throws, logs with logger and other basic things), QA was not able to find any issue on the system after some sprints, but in production using real data that was different, we front lot of data issues because third party services was not perfects, we front time outs, missing data etc and our observability was poor, after that we implement different strategies to improve this using log dashboards (datadog), and implementing a mechanisim of logs with steps and request-ids to track the steps of the users and find the root causes, we implement alarms dispatching notifications to our slack service and creating automatic tickets on jira, also we create new test cases to cover all possible failures with third party servcies and compensation actions to fix it. 

## Q2 — Scaling-forced structural change

In this same scenario of rostering service, the service was created in nestjs using bullmq and mongoose, the issue is that the code was wrote with bad performance practices and using a progamming language that the performance volume data it's not the main advantage. My boss in that moment give me the responsability to re-think the full design, the code was really hard to read, undocumented, and poor with contract names or unreadable, but the auth layer and all other cross microservices layers in the microservices worked fine, instead of invest days trying to fix a code that doesn't make sense at the first, I choosed re-write the solution using a different scope, re-using the layers that already works on the service, and separate the transforming and request process using batchs, concurrency and volume languages for map user data (I choosed golang), reusing the part that make sense, the old service now is just an orchestrator, so nestjs old version still in use as a orchestrator of a azure batch service that run process on golang (golang do great work doing parallel request to third party services and data memory transforming using pointer and great big0 complexity). One of the complicated parts was convince VP and CTO that use golang, a language that most of our engineers doesn't domain, is the right for the new design, and also convince security team that our current layer works fine to cover all security issues without any new auditory, so before all the work that I did, I prepare a demo and presentation just with an MVP demostrating that learn go is easy for most of the develoepers (I learned basic in 2 weeks), and also showing how the security layer worked in the same way without any new issues, The results? Millions of users saved on mongodb in seconds, the old process take hours to process just 1 tenant, our new process process 20 tenants in couple of minutes! 

## Q3 — A time you rejected AI output (or accepted bad output and changed your process)

When I started to use agents I tried to automate most of my work at the first, so in some point AI was doing automatic commits with the research that AI did, couple of bugs in the moment were re-opened lot of times, not just bugs, also old bugs realated with a educational platform, to be exact the issues were that instead of use our multitenant library to create new repositories, I did quick checks of these changes to accelerate my work, that was my fault, AI don't should do all these things without any supervision of my side, now I more aware about it, I try to improve my prompts, I have mcps to provide information of other services, I create plans and tasks before code, but the most important thing is that I read most of the work that AI do and I do my own commits and manual tests before some PR.



